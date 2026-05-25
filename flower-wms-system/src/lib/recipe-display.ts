type IngredientSummaryLine = { chineseName: string; quantity: number };

/** 花材摘要：洛神玫瑰x11, 矢车菊x6 */
export function formatIngredientSummary(
  ingredients: IngredientSummaryLine[]
): string {
  if (ingredients.length === 0) return "未配置物料";
  return ingredients
    .map((line) => `${line.chineseName}x${line.quantity}`)
    .join(", ");
}

/** 下拉展示：BOM-20260525-001 (洛神玫瑰x11, 矢车菊x6) */
export function formatRecipeOptionLabel(
  recipeCode: string,
  ingredients: IngredientSummaryLine[]
): string {
  return `${recipeCode} (${formatIngredientSummary(ingredients)})`;
}
