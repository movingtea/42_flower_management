/** @deprecated 请使用 /api/admin/wms/recipes */
import { jsonError, jsonSuccess } from "@/lib/api";
import { getRecipeForProduct } from "@/services/recipe";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const recipe = await getRecipeForProduct(id);
    return jsonSuccess({
      ingredients: recipe?.ingredients ?? [],
      lines: recipe?.ingredients ?? [],
      recipeId: recipe?.id ?? null,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "加载失败", 500);
  }
}

export async function PUT() {
  return jsonError(
    "商品级 BOM 写入已废弃，请使用 WMS 标准配方中心维护 recipe",
    410
  );
}
