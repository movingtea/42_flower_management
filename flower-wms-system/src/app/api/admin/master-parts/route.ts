import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapMasterPartApiError } from "@/lib/master-parts-api-error";
import { parseMasterPartListParams } from "@/lib/master-parts-pure";
import { createMasterPart, listMasterParts } from "@/services/master-parts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const result = await listMasterParts(parseMasterPartListParams(searchParams));
    return jsonSuccess(result);
  } catch (err) {
    const { message, status } = mapMasterPartApiError(err, "通用物料查询失败");
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const masterPart = await createMasterPart(await request.json());
    return jsonSuccess({ message: "通用物料创建成功", masterPart }, 201);
  } catch (err) {
    const { message, status } = mapMasterPartApiError(err, "通用物料创建失败");
    return jsonError(message, status);
  }
}
