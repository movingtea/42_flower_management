/**
 * 小程序商品列表 tag / 价格 / 排序 / 分页纯函数。
 * 过滤必须在分页之前完成（service 层先 filter + sort，再 paginateAfterFilter）。
 */

export type MiniprogramProductSort =
  | "default"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "recommended"
  | "hot";

export type TagFilterGroups = {
  occasionTags: string[];
  colorTags: string[];
  styleTags: string[];
  relationshipTags: string[];
  budgetTags: string[];
  positioningTags: string[];
};

export type ProductTagFields = TagFilterGroups;

export const BUDGET_TAG_PRICE_RANGES: Record<
  string,
  { min?: number; max?: number }
> = {
  BUDGET_UNDER_268: { max: 268 },
  BUDGET_268_398: { min: 268, max: 398 },
  BUDGET_398_498: { min: 398, max: 498 },
  BUDGET_498_698: { min: 498, max: 698 },
  BUDGET_698_PLUS: { min: 698 },
};

const POSITIONING_RECOMMENDED_KEYS = new Set([
  "DAILY_PROMOTE",
  "NEW_PRODUCT",
  "IMAGE_PRODUCT",
]);

/** 兼容 null / string[] / { key, label }[] / JSON 字符串 */
export function normalizeJsonTags(value: unknown): string[] {
  if (value == null) return [];

  let raw: unknown = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed ? [trimmed.toUpperCase()] : [];
    }
  }

  if (!Array.isArray(raw)) return [];

  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const k = item.trim();
      if (k) keys.push(k.toUpperCase());
      continue;
    }
    if (item && typeof item === "object" && "key" in item) {
      const k = String((item as { key: unknown }).key ?? "").trim();
      if (k) keys.push(k.toUpperCase());
    }
  }

  return [...new Set(keys)];
}

export function parseTagQueryParam(
  singular: string | null | undefined,
  plural: string | null | undefined
): string[] {
  const parts: string[] = [];
  if (singular?.trim()) {
    parts.push(singular.trim());
  }
  if (plural?.trim()) {
    parts.push(
      ...plural
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return [...new Set(parts.map((k) => k.toUpperCase()))];
}

export function parseOptionalNumber(
  value: string | null | undefined
): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number,
  max: number
): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export type NormalizedListQuery = {
  categoryId: string | null;
  keyword: string | null;
  tagFilters: TagFilterGroups;
  minPrice: number | null;
  maxPrice: number | null;
  sort: MiniprogramProductSort;
  page: number | null;
  pageSize: number | null;
};

const SORT_VALUES = new Set<MiniprogramProductSort>([
  "default",
  "newest",
  "price_asc",
  "price_desc",
  "recommended",
  "hot",
]);

export function normalizeTagQueryFromSearchParams(
  params: URLSearchParams
): NormalizedListQuery {
  const occasionTags = parseTagQueryParam(
    params.get("occasionTag"),
    params.get("occasionTags")
  );
  const sceneType = params.get("sceneType")?.trim();
  if (sceneType) {
    occasionTags.push(sceneType.toUpperCase());
  }

  const tagFilters: TagFilterGroups = {
    occasionTags: [...new Set(occasionTags)],
    colorTags: parseTagQueryParam(
      params.get("colorTag"),
      params.get("colorTags")
    ),
    styleTags: parseTagQueryParam(
      params.get("styleTag"),
      params.get("styleTags")
    ),
    relationshipTags: parseTagQueryParam(
      params.get("relationshipTag"),
      params.get("relationshipTags")
    ),
    budgetTags: parseTagQueryParam(
      params.get("budgetTag"),
      params.get("budgetTags")
    ),
    positioningTags: parseTagQueryParam(
      params.get("positioningTag"),
      params.get("positioningTags")
    ),
  };

  const sortRaw = (params.get("sort") ?? "default").trim() as MiniprogramProductSort;
  const sort = SORT_VALUES.has(sortRaw) ? sortRaw : "default";

  const hasPage = params.has("page") || params.has("pageSize");
  const page = hasPage
    ? parsePositiveInt(params.get("page"), 1, 10_000)
    : null;
  const pageSize = hasPage
    ? parsePositiveInt(params.get("pageSize"), 20, 100)
    : null;

  return {
    categoryId:
      params.get("categoryId")?.trim() ||
      params.get("category")?.trim() ||
      null,
    keyword: params.get("keyword")?.trim() || null,
    tagFilters,
    minPrice: parseOptionalNumber(params.get("minPrice")),
    maxPrice: parseOptionalNumber(params.get("maxPrice")),
    sort,
    page,
    pageSize,
  };
}

export function matchAnyTag(
  productTags: string[],
  queryTags: string[]
): boolean {
  if (!queryTags.length) return true;
  if (!productTags.length) return false;
  const set = new Set(productTags.map((t) => t.toUpperCase()));
  return queryTags.some((q) => set.has(q.toUpperCase()));
}

function matchBudgetGroup(
  productTags: ProductTagFields,
  minSkuPrice: number,
  maxSkuPrice: number,
  queryTags: string[]
): boolean {
  if (!queryTags.length) return true;

  const productBudget = productTags.budgetTags;
  if (matchAnyTag(productBudget, queryTags)) return true;

  if (productBudget.length > 0) return false;

  for (const tag of queryTags) {
    const range = BUDGET_TAG_PRICE_RANGES[tag];
    if (!range) continue;
    if (matchPriceRange(minSkuPrice, maxSkuPrice, range.min, range.max)) {
      return true;
    }
  }

  return false;
}

export function matchPriceRange(
  minSkuPrice: number,
  maxSkuPrice: number,
  minPrice?: number | null,
  maxPrice?: number | null
): boolean {
  if (minPrice != null && maxSkuPrice < minPrice) return false;
  if (maxPrice != null && minSkuPrice > maxPrice) return false;
  return true;
}

export function matchAllFilterGroups(
  productTags: ProductTagFields,
  filters: TagFilterGroups
): boolean {
  if (!matchAnyTag(productTags.occasionTags, filters.occasionTags)) return false;
  if (!matchAnyTag(productTags.colorTags, filters.colorTags)) return false;
  if (!matchAnyTag(productTags.styleTags, filters.styleTags)) return false;
  if (!matchAnyTag(productTags.relationshipTags, filters.relationshipTags))
    return false;
  if (!matchAnyTag(productTags.positioningTags, filters.positioningTags))
    return false;
  return true;
}

export function matchProductFilters(
  productTags: ProductTagFields,
  minSkuPrice: number,
  maxSkuPrice: number,
  filters: TagFilterGroups,
  minPrice: number | null,
  maxPrice: number | null
): boolean {
  if (!matchAllFilterGroups(productTags, filters)) return false;
  if (!matchBudgetGroup(productTags, minSkuPrice, maxSkuPrice, filters.budgetTags))
    return false;
  if (!matchPriceRange(minSkuPrice, maxSkuPrice, minPrice, maxPrice)) return false;
  return true;
}

export type SortableProduct = {
  minPriceNum: number;
  maxPriceNum: number;
  createdAt: Date;
  positioningTags: string[];
  name: string;
};

export function sortProducts<T extends SortableProduct>(
  items: T[],
  sort: MiniprogramProductSort
): T[] {
  const copy = [...items];

  switch (sort) {
    case "newest":
      copy.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      break;
    case "price_asc":
      copy.sort((a, b) => a.minPriceNum - b.minPriceNum);
      break;
    case "price_desc":
      copy.sort((a, b) => b.maxPriceNum - a.maxPriceNum);
      break;
    case "recommended":
      copy.sort((a, b) => {
        const score = (p: T) => {
          let s = 0;
          if (
            p.positioningTags.some((k) => POSITIONING_RECOMMENDED_KEYS.has(k))
          ) {
            s += 10;
          }
          return s;
        };
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, "zh-CN");
      });
      break;
    case "hot":
    case "default":
    default:
      copy.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      break;
  }

  return copy;
}

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function paginateAfterFilter<T>(
  items: T[],
  page: number,
  pageSize: number
): PaginationResult<T> {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = Math.max(1, Math.min(page, Math.max(totalPages, 1)));
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

/** 至少有一个 SKU，且未全售罄或允许预约 */
export function hasSellableSku(
  skus: { stock: number }[],
  allowPreOrder: boolean
): boolean {
  if (!skus.length) return false;
  const allOut = skus.every((s) => s.stock <= 0);
  return !allOut || allowPreOrder;
}

export function buildPriceRangeText(minPrice: number, maxPrice: number): string {
  if (!Number.isFinite(minPrice) || minPrice <= 0) return "¥0.00";
  const min = minPrice.toFixed(2);
  if (maxPrice <= minPrice) return `¥${min}`;
  return `¥${min} - ¥${maxPrice.toFixed(2)}`;
}
