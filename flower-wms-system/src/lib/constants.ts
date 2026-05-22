/** WMS 原材料分类（采购入库、物理库存） */
export enum WmsCategory {
  FLOWER = "FLOWER",
  LEAF = "LEAF",
  PACK = "PACK",
  TOOL = "TOOL",
}

export const WMS_CATEGORY_LABEL: Record<WmsCategory, string> = {
  [WmsCategory.FLOWER]: "鲜花花材",
  [WmsCategory.LEAF]: "叶材配叶",
  [WmsCategory.PACK]: "包装周边",
  [WmsCategory.TOOL]: "花艺工具",
};

export const WMS_CATEGORY_OPTIONS = (
  Object.entries(WMS_CATEGORY_LABEL) as [WmsCategory, string][]
).map(([value, label]) => ({ value, label }));

const WMS_CATEGORY_SET = new Set<string>(Object.values(WmsCategory));

export function parseWmsCategory(value: unknown): WmsCategory | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const upper = value.trim().toUpperCase();
  return WMS_CATEGORY_SET.has(upper) ? (upper as WmsCategory) : null;
}

export function wmsCategoryLabel(category: string): string {
  return WMS_CATEGORY_LABEL[category as WmsCategory] ?? category;
}

/** WMS 原材料主分类（数组时取首项） */
export function wmsCategoryLabelFromArray(categories: string[]): string {
  const primary = categories[0];
  return primary ? wmsCategoryLabel(primary) : "—";
}
