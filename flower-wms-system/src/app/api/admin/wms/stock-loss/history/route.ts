import { jsonError, jsonSuccess } from "@/lib/api";
import {
  listStockLossHistory,
  listStockLossHistoryByMaterialId,
} from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const flowerWikiId = searchParams.get("flowerWikiId")?.trim();
    const materialId = searchParams.get("materialId")?.trim();

    if (materialId) {
      const items = await listStockLossHistoryByMaterialId(materialId);
      return jsonSuccess({ items });
    }

    if (flowerWikiId) {
      const items = await listStockLossHistory(flowerWikiId);
      return jsonSuccess({ items });
    }

    return jsonError("请提供 flowerWikiId 或 materialId", 400);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "查询失败", 500);
  }
}
