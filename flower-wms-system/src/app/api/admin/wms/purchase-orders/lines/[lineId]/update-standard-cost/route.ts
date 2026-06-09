import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { mapPurchaseApiError } from "@/lib/purchase-api-error";
import { updateFlowerStandardCostFromPurchaseLine } from "@/services/purchase";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ lineId: string }> }
) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const { lineId } = await ctx.params;
    const item = await updateFlowerStandardCostFromPurchaseLine(lineId);
    return jsonSuccess({ message: "花材标准成本已更新", item });
  } catch (err) {
    const { message, status } = mapPurchaseApiError(err, "标准成本更新失败");
    return jsonError(message, status);
  }
}
