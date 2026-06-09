import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import { calculatePurchaseOrderPreview } from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const result = await calculatePurchaseOrderPreview(await request.json());
    return jsonSuccess(result);
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "采购成本预览失败");
    return jsonError(message, status);
  }
}
