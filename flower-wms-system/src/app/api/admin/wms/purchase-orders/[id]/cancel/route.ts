import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
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
    return jsonSuccess({ message: "采购单已取消", purchaseOrder });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单取消失败");
    return jsonError(message, status);
  }
}
