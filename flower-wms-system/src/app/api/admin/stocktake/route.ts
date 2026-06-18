import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { adjustStockByStocktake } from "@/services/stocktake";
import type { StocktakeInput } from "@/types";

export async function POST(request: Request) {
  try {
    const staff = await requirePermission("wms:write");
    if (isResponse(staff)) return staff;

    const body = (await request.json()) as StocktakeInput;

    if (!body.batchId || body.newRemainingQty == null) {
      return jsonError("缺少 batchId 或 newRemainingQty");
    }

    const result = await adjustStockByStocktake(body);
    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "盘点调整失败";
    return jsonError(message, 500);
  }
}
