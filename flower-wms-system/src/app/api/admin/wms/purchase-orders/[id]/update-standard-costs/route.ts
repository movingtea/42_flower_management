import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import { updateFlowerStandardCostsFromPurchaseOrder } from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const result = await updateFlowerStandardCostsFromPurchaseOrder(id);
    return jsonSuccess({
      message: `已更新 ${result.updatedCount} 个花材标准成本`,
      ...result,
    });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "标准成本更新失败");
    return jsonError(message, status);
  }
}
