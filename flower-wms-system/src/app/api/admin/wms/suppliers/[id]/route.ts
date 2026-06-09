import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import {
  deactivateSupplier,
  getSupplierById,
  updateSupplier,
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
    const supplier = await getSupplierById(id);
    return jsonSuccess({ supplier });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "供应商查询失败");
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
    const supplier = await updateSupplier(id, await request.json());
    return jsonSuccess({ message: "供应商已更新", supplier });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "供应商更新失败");
    return jsonError(message, status);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const supplier = await deactivateSupplier(id);
    return jsonSuccess({ message: "供应商已停用", supplier });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "供应商停用失败");
    return jsonError(message, status);
  }
}
