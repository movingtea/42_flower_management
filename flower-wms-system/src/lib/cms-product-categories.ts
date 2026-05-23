/** @deprecated 商品分类已迁至 Category 表，仅 AppConfig 兼容读取保留 */
export const CMS_PRODUCT_CATEGORIES_KEY = "CMS_PRODUCT_CATEGORIES";

/** @deprecated */
export const CMS_PRODUCT_CATEGORIES_NAME = "商城商品分类";

/** CMS / 小程序商品分类选项（以数据库 Category.id 为值） */
export type CmsProductCategoryItem = {
  id: string;
  label: string;
  sortOrder: number;
  parentId: string | null;
  depth?: number;
};

export function sortCmsProductCategories(
  items: CmsProductCategoryItem[]
): CmsProductCategoryItem[] {
  return [...items].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "zh-CN")
  );
}

export function cmsCategoryIdSet(items: CmsProductCategoryItem[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

export function formatCmsCategoryLabels(
  categoryIds: string[],
  config: CmsProductCategoryItem[]
): string {
  if (categoryIds.length === 0) return "未分类";
  const labelById = new Map(config.map((c) => [c.id, c.label.replace(/^　+└\s*/, "")]));
  return categoryIds.map((id) => labelById.get(id) ?? id).join("、");
}

/**
 * 将 API 请求体中的 category 规范为分类 id 数组。
 */
export function normalizeProductCategoryArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
      ),
    ];
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function parseProductCategoryPayload(
  raw: unknown,
  allowed: Set<string>
): string[] {
  const values = normalizeProductCategoryArray(raw);

  if (values.length === 0) {
    throw new Error("请至少选择一个商品分类");
  }

  const invalid = values.filter((v) => !allowed.has(v));
  if (invalid.length > 0) {
    throw new Error(`分类无效：${invalid.join(", ")}`);
  }

  return values;
}

/** @deprecated AppConfig 旧版 JSON，请使用 /cms/categories */
export type LegacyCmsCategoryConfigItem = {
  value: string;
  label: string;
  sortOrder: number;
};

/** @deprecated 仅用于 AppConfig GET 回显迁移期数据 */
export function parseCmsProductCategoriesValue(
  value: unknown
): LegacyCmsCategoryConfigItem[] {
  if (!Array.isArray(value)) return [];
  const items: LegacyCmsCategoryConfigItem[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const v = typeof r.value === "string" ? r.value.trim() : "";
    const sortOrder = Number(r.sortOrder);
    if (!label || !v || !Number.isFinite(sortOrder)) continue;
    items.push({ value: v, label, sortOrder: Math.round(sortOrder) });
  }
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** @deprecated */
export function validateCmsProductCategories(
  _items: LegacyCmsCategoryConfigItem[]
): string | null {
  return "商品分类已迁移至「商品分类管理」页面，请在该页面维护分类树";
}
