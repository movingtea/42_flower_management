import { request } from './request';
import type { ProductFilters } from './product-filters';
import type { WechatProductRaw } from './product';

export type ProductListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type FetchProductListParams = {
  keyword?: string;
  categoryId?: string;
  filters?: ProductFilters;
  sceneType?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
};

export type ProductListResponse = {
  list?: WechatProductRaw[];
  products?: WechatProductRaw[];
  pagination?: ProductListPagination;
  total?: number;
};

const DEFAULT_PAGE_SIZE = 20;

function appendTagParam(
  parts: string[],
  singular: string,
  plural: string,
  value?: string
) {
  if (!value) return;
  parts.push(`${singular}=${encodeURIComponent(value)}`);
}

/** 将筛选条件转为服务端 query（tag 过滤在服务端完成） */
export function buildProductListQuery(params: FetchProductListParams): string {
  const parts: string[] = [];
  const { keyword, categoryId, filters, sceneType, page, pageSize, sort, minPrice, maxPrice } =
    params;

  if (categoryId) {
    parts.push(`categoryId=${encodeURIComponent(categoryId)}`);
  }
  if (keyword?.trim()) {
    parts.push(`keyword=${encodeURIComponent(keyword.trim())}`);
  }

  const occasion = filters?.occasion || sceneType;
  appendTagParam(parts, 'occasionTag', 'occasionTags', occasion);
  appendTagParam(parts, 'colorTag', 'colorTags', filters?.color);
  appendTagParam(parts, 'styleTag', 'styleTags', filters?.style);
  appendTagParam(parts, 'relationshipTag', 'relationshipTags', filters?.relationship);
  appendTagParam(parts, 'budgetTag', 'budgetTags', filters?.budget);

  if (sceneType && !filters?.occasion) {
    parts.push(`sceneType=${encodeURIComponent(sceneType)}`);
  }

  if (minPrice != null && Number.isFinite(minPrice)) {
    parts.push(`minPrice=${minPrice}`);
  }
  if (maxPrice != null && Number.isFinite(maxPrice)) {
    parts.push(`maxPrice=${maxPrice}`);
  }

  if (sort && sort !== 'default') {
    parts.push(`sort=${encodeURIComponent(sort)}`);
  }

  const resolvedPage = page ?? 1;
  const resolvedSize = pageSize ?? DEFAULT_PAGE_SIZE;
  parts.push(`page=${resolvedPage}`);
  parts.push(`pageSize=${resolvedSize}`);

  return parts.length ? `?${parts.join('&')}` : '';
}

export function fetchProductList(params: FetchProductListParams) {
  const query = buildProductListQuery(params);
  return request<ProductListResponse>({
    url: `/products${query}`,
  });
}

export { DEFAULT_PAGE_SIZE };
