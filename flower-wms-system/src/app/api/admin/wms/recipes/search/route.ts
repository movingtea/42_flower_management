import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { searchRecipesForPicker } from "@/services/recipe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    const keyword = params.get("keyword");
    const limit = Number(params.get("limit") ?? 30);

    const items = await searchRecipesForPicker(keyword, limit);
    return jsonSuccess({ items });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "配方搜索失败";
    return jsonError(message, 500);
  }
}
