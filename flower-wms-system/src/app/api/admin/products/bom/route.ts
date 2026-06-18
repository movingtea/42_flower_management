/** @deprecated 请使用 /api/admin/wms/recipes；配方通过 SKU.recipeId 挂载 */
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getRecipeForProduct } from "@/services/recipe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId")?.trim() ?? "";
    if (!productId) {
      return jsonError("请提供 productId 查询参数", 400);
    }

    const recipe = await getRecipeForProduct(productId);
    return jsonSuccess({
      productId,
      recipeId: recipe?.id ?? null,
      ingredients: recipe?.ingredients ?? [],
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "查询失败", 500);
  }
}

export async function POST() {
  const staff = await requirePermission("wms:write");
  if (isResponse(staff)) return staff;

  return jsonError(
    "商品级 BOM 写入已废弃，请先在 WMS 创建标准配方，再在商品款式（SKU）上挂载 recipeId",
    410
  );
}
