import type { ProductSkuEditorRow } from "@/app/cms/products/types";

/** CMS 单规格商品默认 SKU 名称（存库；小程序单 SKU 时不展示款式选择器） */
export const DEFAULT_SINGLE_SPEC_NAME = "单规格";

/** 历史默认名称，保存时仍视为有效单规格 */
export const LEGACY_SINGLE_SPEC_NAMES = ["标准款", "默认规格", "默认款"] as const;

export function isSingleSpecProduct(skuCount: number): boolean {
  return skuCount === 1;
}

export function isDefaultSingleSpecName(specName: string): boolean {
  const trimmed = specName.trim();
  return (
    trimmed === DEFAULT_SINGLE_SPEC_NAME ||
    (LEGACY_SINGLE_SPEC_NAMES as readonly string[]).includes(trimmed)
  );
}

/** 新建商品默认 SKU 草稿行 */
export function createDefaultSkuDraftRow(
  sortOrder = 0
): ProductSkuEditorRow {
  return {
    specName: DEFAULT_SINGLE_SPEC_NAME,
    price: "",
    stock: 0,
    imageUrl: "",
    isMainImage: sortOrder === 0,
    isActive: true,
    sortOrder,
    recipeId: null,
    bulkPreorderEnabled: false,
    bulkOrderThreshold: "",
    bulkMinLeadDays: "",
    bulkPreorderMessage: "",
  };
}

/** 保存前解析款式品名：单规格允许留空并回填默认名 */
export function resolveSkuSpecNameForSave(
  specName: string,
  skuCount: number,
  rowIndex: number
): string {
  const trimmed = specName.trim();
  if (trimmed) return trimmed;
  if (isSingleSpecProduct(skuCount)) return DEFAULT_SINGLE_SPEC_NAME;
  throw new Error(`款式第 ${rowIndex + 1} 行须填写款式品名`);
}

/** 小程序端是否展示款式选择器（仅多 SKU） */
export function shouldShowMiniprogramSpecSelector(activeSkuCount: number): boolean {
  return activeSkuCount > 1;
}

/** 小程序 UI 展示用规格名：单 SKU 不展示「单规格」等后台默认名 */
export function formatMiniprogramSpecLabel(
  specName: string,
  activeSkuCount: number
): string {
  if (!shouldShowMiniprogramSpecSelector(activeSkuCount)) return "";
  return specName.trim();
}

export function countEnabledSkus(
  rows: Array<{ isActive?: boolean }>
): number {
  return rows.filter((r) => r.isActive !== false).length;
}
