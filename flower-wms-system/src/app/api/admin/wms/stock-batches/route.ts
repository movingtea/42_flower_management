import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { listWikiAvailableBatches } from "@/services/wms-stock";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const flowerWikiId = searchParams.get("flowerWikiId")?.trim();

    if (!flowerWikiId) {
      return jsonError("flowerWikiId 不能为空", 400);
    }

    const items = await listWikiAvailableBatches(flowerWikiId);
    return jsonSuccess({ items });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "查询失败", 500);
  }
}
