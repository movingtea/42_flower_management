import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { resolveOperatorContext } from "@/lib/operator-context";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import { receivePurchaseOrder } from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const operator = await resolveOperatorContext(staff.id);
    const receivedAt =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).receivedAt
        : undefined;
    const result = await receivePurchaseOrder(id, {
      operator,
      receivedAt:
        typeof receivedAt === "string" || receivedAt instanceof Date || receivedAt === null
          ? receivedAt
          : undefined,
    });
    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.PURCHASE,
        action: "PURCHASE_ORDER_RECEIVE",
        entityType: "PurchaseOrder",
        entityId: id,
        summary: `采购单到货入库`,
        metadata: { purchaseOrderId: id },
      },
      request
    );
    return jsonSuccess({ message: "采购单已到货入库", ...result });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单入库失败");
    return jsonError(message, status);
  }
}
