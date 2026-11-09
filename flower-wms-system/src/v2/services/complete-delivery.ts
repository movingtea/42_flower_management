import {
  CommercialState, DeliveryAttemptState, FulfillmentKind, FulfillmentState,
  ProductionState, type PrismaClient,
} from "../../generated/prisma-v2/client";
import { calculateOrderCostBreakdown } from "./order-cost-management";

function centsToMoney(value: number): string {
  const cents = Math.round(value * 100);
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/**
 * Completes pickup or delivery exactly once.
 *
 * Delivery orders must have a started attempt; the attempt is closed together with the order so a
 * courier can never be marked delivered without actually leaving the store. The completion writes
 * one new immutable cost revision instead of overwriting history, which lets `adjustFinalCost` and
 * `recordDeliveryActualCost` append corrections to the snapshot.
 */
export async function completeDelivery(
  db: PrismaClient,
  orderId: string,
  tenantId: string,
  storeId: string,
  staffId: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        fulfillment: {
          include: { attempts: { orderBy: { attemptNo: "desc" } } },
        },
        costEntries: true,
        costSnapshots: { orderBy: { revisionNo: "asc" } },
      },
    });
    if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
      throw new Error("订单不存在");
    }
    // Idempotent replay: never append another snapshot or touch the handover fields twice.
    if (order.fulfillmentState === FulfillmentState.DELIVERED) return;

    if (order.commercialState !== CommercialState.CONFIRMED
        || order.productionState !== ProductionState.COMPLETED) {
      throw new Error("订单尚未完成制作或确认");
    }
    if (order.fulfillmentState !== FulfillmentState.WAITING_PICKUP
        && order.fulfillmentState !== FulfillmentState.WAITING_DELIVERY
        && order.fulfillmentState !== FulfillmentState.DELIVERING) {
      throw new Error("订单当前不能交付");
    }
    if (!order.fulfillment) throw new Error("缺少交付方式");
    const fulfillment = order.fulfillment;

    let completedAttempt: (typeof fulfillment.attempts)[number] | undefined;
    if (fulfillment.kind === FulfillmentKind.DELIVERY) {
      completedAttempt = fulfillment.attempts.find(
        (attempt) => attempt.state === DeliveryAttemptState.OUT_FOR_DELIVERY,
      );
      if (!completedAttempt) throw new Error("配送订单需先开始配送尝试");
    } else if (fulfillment.kind !== FulfillmentKind.PICKUP) {
      throw new Error("交付方式无效");
    }

    // The attempt is the most precise actual cost for this handover. Passing it through the
    // fallback field never adds it on top of an existing DELIVERY CostEntry.
    const deliveryCostActual = completedAttempt?.deliveryCost ?? fulfillment.deliveryCostActual;
    const breakdown = calculateOrderCostBreakdown({
      items: order.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        estimatedConsumableCostSnapshot: item.estimatedConsumableCostSnapshot,
        estimatedLaborCostSnapshot: item.estimatedLaborCostSnapshot,
      })),
      fulfillment: {
        kind: fulfillment.kind,
        deliveryFeeCharged: fulfillment.deliveryFeeCharged,
        deliveryCostActual,
        deliveryCostEstimated: fulfillment.deliveryCostEstimated,
      },
      entries: order.costEntries.map((entry) => ({
        kind: entry.kind,
        stage: entry.stage,
        amount: entry.amount,
        estimated: entry.estimated,
      })),
    });

    const revisionNo = order.costSnapshots.reduce(
      (max, snapshot) => Math.max(max, snapshot.revisionNo),
      0,
    ) + 1;
    const completedAt = new Date();
    await tx.orderCostSnapshot.create({
      data: {
        orderId,
        revisionNo,
        revenue: centsToMoney(breakdown.revenue),
        materialCost: centsToMoney(breakdown.materialCost),
        packagingCost: centsToMoney(breakdown.packagingCost),
        consumableCost: centsToMoney(breakdown.consumableCost),
        laborCost: centsToMoney(breakdown.laborCost),
        deliveryCost: centsToMoney(breakdown.deliveryCost),
        platformCost: centsToMoney(breakdown.platformCost),
        attributedLossCost: centsToMoney(breakdown.attributedLossCost),
        estimated: breakdown.estimated,
      },
    });

    if (completedAttempt) {
      await tx.deliveryAttempt.update({
        where: { id: completedAttempt.id },
        data: {
          state: DeliveryAttemptState.DELIVERED,
          completedAt,
        },
      });
    }
    await tx.fulfillment.update({
      where: { id: fulfillment.id },
      data: { handedOverAt: completedAt, handedOverById: staffId },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { fulfillmentState: FulfillmentState.DELIVERED },
    });
    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId: staffId,
        action: "DELIVERY_COMPLETED",
        entityType: "Order",
        entityId: orderId,
        afterSnapshot: {
          method: fulfillment.kind,
          fulfillmentKind: fulfillment.kind,
          attemptNo: completedAttempt?.attemptNo ?? null,
          revisionNo,
          handedOverById: staffId,
        },
      },
    });
  }, { timeout: 30_000 });
}
