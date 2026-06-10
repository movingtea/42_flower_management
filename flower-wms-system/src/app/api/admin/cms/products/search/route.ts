import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { searchProductsForPicker } from "@/services/cms-product-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("cms:read");
    if (isResponse(staff)) return staff;

    const params = new URL(request.url).searchParams;
    const keyword = params.get("keyword");
    const limit = Number(params.get("limit") ?? 20);

    const items = await searchProductsForPicker(keyword, limit);
    return jsonSuccess({ items });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "商品搜索失败";
    return jsonError(message, 500);
  }
}
