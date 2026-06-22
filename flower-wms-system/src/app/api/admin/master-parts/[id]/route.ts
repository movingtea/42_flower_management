import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapMasterPartApiError } from "@/lib/master-parts-api-error";
import {
  deleteOrDeactivateMasterPart,
  getMasterPart,
  updateMasterPart,
} from "@/services/master-parts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const masterPart = await getMasterPart(id);
    return jsonSuccess({ masterPart });
  } catch (err) {
    const { message, status } = mapMasterPartApiError(err, "通用物料查询失败");
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
    const masterPart = await updateMasterPart(id, await request.json());
    return jsonSuccess({ message: "通用物料已更新", masterPart });
  } catch (err) {
    const { message, status } = mapMasterPartApiError(err, "通用物料更新失败");
    return jsonError(message, status);
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return PUT(request, ctx);
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const masterPart = await deleteOrDeactivateMasterPart(id);
    return jsonSuccess({ message: "通用物料已停用", masterPart });
  } catch (err) {
    const { message, status } = mapMasterPartApiError(err, "通用物料停用失败");
    return jsonError(message, status);
  }
}
