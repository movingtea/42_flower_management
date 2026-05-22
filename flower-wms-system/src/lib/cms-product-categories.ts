/** AppConfig.key：CMS 商城商品动态分类（纯函数，可安全用于 Client Component） */
export const CMS_PRODUCT_CATEGORIES_KEY = "CMS_PRODUCT_CATEGORIES";

export const CMS_PRODUCT_CATEGORIES_NAME = "商城商品分类";

export type CmsProductCategoryItem = {
  value: string;
  label: string;
  sortOrder: number;
};

export const DEFAULT_CMS_PRODUCT_CATEGORIES: CmsProductCategoryItem[] = [
  { value: "BOUQUET", label: "节日手捧花束", sortOrder: 1 },
  { value: "DAILY", label: "日常现切周花", sortOrder: 2 },
  { value: "FOREVER", label: "永生花艺礼盒", sortOrder: 3 },
  { value: "PLANT", label: "绿植盆栽开业花篮", sortOrder: 4 },
];

export function sortCmsProductCategories(
  items: CmsProductCategoryItem[]
): CmsProductCategoryItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function parseCmsProductCategoriesValue(
  value: unknown
): CmsProductCategoryItem[] {
  if (!Array.isArray(value)) {
    return sortCmsProductCategories([...DEFAULT_CMS_PRODUCT_CATEGORIES]);
  }

  const items: CmsProductCategoryItem[] = [];
  const seen = new Set<string>();

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const rawValue =
      typeof r.value === "string" ? r.value.trim().toUpperCase() : "";
    const sortOrder = Number(r.sortOrder);

    if (!label || !rawValue || !Number.isFinite(sortOrder)) continue;
    if (seen.has(rawValue)) continue;
    seen.add(rawValue);

    items.push({
      value: rawValue,
      label,
      sortOrder: Math.round(sortOrder),
    });
  }

  if (items.length === 0) {
    return sortCmsProductCategories([...DEFAULT_CMS_PRODUCT_CATEGORIES]);
  }

  return sortCmsProductCategories(items);
}

export function validateCmsProductCategories(
  items: CmsProductCategoryItem[]
): string | null {
  if (items.length === 0) return "至少保留一个分类";

  const values = new Set<string>();
  for (const item of items) {
    if (!item.label.trim()) return "分类名称不能为空";
    if (!/^[A-Z][A-Z0-9_]*$/.test(item.value)) {
      return `分类标识键无效：${item.value}（须为大写英文，如 BOUQUET）`;
    }
    if (values.has(item.value)) return `分类标识键重复：${item.value}`;
    values.add(item.value);
  }

  return null;
}

export function cmsCategoryValueSet(
  items: CmsProductCategoryItem[]
): Set<string> {
  return new Set(items.map((i) => i.value));
}

export function formatCmsCategoryLabels(
  categoryValues: string[],
  config: CmsProductCategoryItem[]
): string {
  if (categoryValues.length === 0) return "未分类";
  const labelByValue = new Map(config.map((c) => [c.value, c.label]));
  return categoryValues
    .map((v) => labelByValue.get(v) ?? labelByValue.get(v.toUpperCase()) ?? v)
    .join("、");
}

/**
 * 将 API 请求体中的 category 规范为字符串数组（分类 code）。
 * 数据库商品分类请使用 categoryCodesFromProduct（@/lib/product-categories）。
 */
export function normalizeProductCategoryArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim().toUpperCase()];
  }
  return [];
}

export function parseProductCategoryPayload(
  raw: unknown,
  allowed: Set<string>
): string[] {
  let values: string[] = [];

  if (Array.isArray(raw)) {
    values = raw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
  } else if (typeof raw === "string" && raw.trim()) {
    values = [raw.trim().toUpperCase()];
  }

  values = [...new Set(values)];

  if (values.length === 0) {
    throw new Error("请至少选择一个商品分类");
  }

  const invalid = values.filter((v) => !allowed.has(v));
  if (invalid.length > 0) {
    throw new Error(`分类无效：${invalid.join(", ")}`);
  }

  return values;
}
