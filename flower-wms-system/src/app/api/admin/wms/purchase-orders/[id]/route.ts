import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import {
  getPurchaseOrderById,
  updatePurchaseOrder,
} from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const purchaseOrder = await getPurchaseOrderById(id);
    return jsonSuccess({ purchaseOrder });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单查询失败");
    return jsonError(message, status);
  }
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const purchaseOrder = await updatePurchaseOrder(id, await request.json());
    return jsonSuccess({ message: "采购单已更新", purchaseOrder });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购单更新失败");
    return jsonError(message, status);
  }
}
