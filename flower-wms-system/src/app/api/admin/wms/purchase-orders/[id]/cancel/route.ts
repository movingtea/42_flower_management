import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import { cancelPurchaseOrder } from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const purchaseOrder = await cancelPurchaseOrder(id);
    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.PURCHASE,
        action: "PURCHASE_ORDER_CANCEL",
        entityType: "PurchaseOrder",
        entityId: purchaseOrder.id,
        summary: `取消采购单 ${purchaseOrder.purchaseNo}`,
        afterSnapshot: { status: purchaseOrder.status },
      },
      _request
    );
    return jsonSuccess({ message: "采购单已取消", purchaseOrder });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单取消失败");
    return jsonError(message, status);
  }
}
