import { CommercialState, PrismaClient } from "../../generated/prisma-v2-draft/client";
import { confirmManualOrder } from "./manual-order";

export type SupplyRecheckOptions = {
  /** Purchase line whose explicit demand allocations get priority after its receipt. */
  purchaseLineId?: string;
};

/**
 * A receipt retries affected pending orders. Orders explicitly linked to the received purchase
 * line are checked first, in createdAt order, then every other pending order for the accepted
 * material. A failed order remains visibly pending.
 *
 * A downgraded receipt is passed in with the accepted material, so it can only help requirements
 * for that material. Linked orders for the original purchase material are still rechecked first,
 * but confirmation always re-evaluates their current requirements and will leave them short when
 * the arrived specification does not satisfy the demand.
 */
export async function recheckSupplyAfterReceipt(
  db: PrismaClient,
  tenantId: string,
  storeId: string,
  materialId: string,
  options: SupplyRecheckOptions = {},
): Promise<{ checked: number; failed: number }> {
  const linkedCandidates = options.purchaseLineId
    ? await db.order.findMany({
        where: {
          tenantId,
          storeId,
          commercialState: CommercialState.PENDING_CONFIRMATION,
          items: {
            some: {
              requirements: {
                some: { purchaseAllocations: { some: { purchaseLineId: options.purchaseLineId } } },
              },
            },
          },
        },
        select: {
          id: true,
          revisions: { orderBy: { number: "desc" }, take: 1, select: { id: true } },
          items: {
            select: {
              requirements: {
                select: {
                  revisionId: true,
                  purchaseAllocations: {
                    where: { purchaseLineId: options.purchaseLineId },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const linked = linkedCandidates.filter((order) => {
    const latestRevision = order.revisions[0];
    if (!latestRevision) return false;
    return order.items.some((item) =>
      item.requirements.some((requirement) =>
        requirement.revisionId === latestRevision.id && requirement.purchaseAllocations.length > 0));
  });

  const affected = await db.order.findMany({
    where: {
      tenantId, storeId, commercialState: CommercialState.PENDING_CONFIRMATION,
      items: { some: { requirements: { some: { materialId } } } },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  // Linked current requirements keep their own createdAt fairness, then unlinked orders follow.
  const linkedIds = new Set(linked.map((order) => order.id));
  const orders = [
    ...linked.map((order) => order.id),
    ...affected.filter((order) => !linkedIds.has(order.id)).map((order) => order.id),
  ];
  let failed = 0;
  for (const orderId of orders) {
    try { await confirmManualOrder(db, orderId, tenantId, storeId); }
    catch (error) {
      failed++;
      console.error(`Supply recheck failed for order ${orderId}`, error);
    }
  }
  return { checked: orders.length, failed };
}
