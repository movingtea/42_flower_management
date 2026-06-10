import type { Prisma } from "@/generated/prisma/client";
import { buildWechatOperationTags } from "@/lib/cms-product-tags";
import { activeSpuWhere } from "@/lib/product-query";
import {
  formatMinPriceLabel,
  isSpuOutOfStock,
  productSpuInclude,
  resolveSpuMaxPrice,
  resolveSpuMinPrice,
  type ProductSpuWithRelations,
} from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";
import {
  mapSpuToWechatListItem,
  type WechatProductListItem,
} from "@/lib/wechat-product-mapper";
import {
  buildPriceRangeText,
  hasSellableSku,
  matchProductFilters,
  normalizeJsonTags,
  normalizeTagQueryFromSearchParams,
  paginateAfterFilter,
  sortProducts,
  type NormalizedListQuery,
} from "@/services/miniprogram-product-filter-pure";

type InternalCandidate = WechatProductListItem & {
  minPriceNum: number;
  maxPriceNum: number;
  createdAt: Date;
  positioningTagKeys: string[];
  categoryName: string | null;
  priceRangeText: string;
  defaultSkuId: string | null;
  coverImage: string;
  subtitle: string | null;
};

function extractRawTagFields(spu: ProductSpuWithRelations) {
  return {
    occasionTags: normalizeJsonTags(spu.occasionTags),
    colorTags: normalizeJsonTags(spu.colorTags),
    styleTags: normalizeJsonTags(spu.styleTags),
    relationshipTags: normalizeJsonTags(spu.relationshipTags),
    budgetTags: normalizeJsonTags(spu.budgetTags),
    positioningTags: normalizeJsonTags(spu.positioningTags),
  };
}

function pickDefaultSkuId(spu: ProductSpuWithRelations): string | null {
  if (!spu.skus.length) return null;
  const main = spu.skus.find((s) => s.isMainImage);
  return (main ?? spu.skus[0]).id;
}

function pickCategoryName(spu: ProductSpuWithRelations): string | null {
  const first = spu.categories[0]?.productCategory;
  return first?.name ?? null;
}

function toPublicListItem(item: InternalCandidate) {
  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    coverImage: item.coverImage,
    images: item.images,
    minPrice: item.minPrice,
    maxPrice: item.maxPriceNum.toFixed(2),
    priceRangeText: item.priceRangeText,
    priceSuffix: item.priceSuffix,
    sellPrice: item.sellPrice,
    category: item.category,
    categoryName: item.categoryName,
    description: item.description,
    maintenanceGuide: item.maintenanceGuide,
    mainImageUrl: item.mainImageUrl,
    imageUrl: item.imageUrl,
    skuCount: item.skuCount,
    isOutOfStock: item.isOutOfStock,
    shippingFee: item.shippingFee,
    allowPreOrder: item.allowPreOrder,
    productionTime: item.productionTime,
    defaultSkuId: item.defaultSkuId,
    skus: item.skus,
    occasionTags: item.occasionTags,
    colorTags: item.colorTags,
    styleTags: item.styleTags,
    relationshipTags: item.relationshipTags,
    budgetTags: item.budgetTags,
    positioningTags: item.positioningTags,
    sellingPoints: item.sellingPoints,
  };
}

function buildSpuWhere(query: NormalizedListQuery): Prisma.ProductSpuWhereInput {
  const { categoryId, keyword } = query;

  return {
    ...activeSpuWhere,
    isActive: true,
    ...(categoryId
      ? {
          categories: {
            some: { productCategoryId: categoryId },
          },
        }
      : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { description: { contains: keyword, mode: "insensitive" } },
            {
              skus: {
                some: {
                  OR: [
                    { specName: { contains: keyword, mode: "insensitive" } },
                    { skuCode: { contains: keyword, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}

function mapCandidate(spu: ProductSpuWithRelations): InternalCandidate | null {
  if (!hasSellableSku(spu.skus, spu.allowPreOrder)) {
    return null;
  }

  const minPriceNum = resolveSpuMinPrice(spu.skus);
  const maxPriceNum = resolveSpuMaxPrice(spu.skus);
  if (!Number.isFinite(minPriceNum) || minPriceNum <= 0) {
    return null;
  }

  const base = mapSpuToWechatListItem(spu);
  const { displayPrice, priceSuffix } = formatMinPriceLabel(
    minPriceNum,
    base.skus.length
  );
  const rawTags = extractRawTagFields(spu);
  const displayTags = buildWechatOperationTags(spu);

  return {
    ...base,
    minPrice: displayPrice,
    sellPrice: displayPrice,
    priceSuffix,
    occasionTags: displayTags.occasionTags,
    colorTags: displayTags.colorTags,
    styleTags: displayTags.styleTags,
    relationshipTags: displayTags.relationshipTags,
    budgetTags: displayTags.budgetTags,
    positioningTags: displayTags.positioningTags,
    sellingPoints: displayTags.sellingPoints,
    minPriceNum,
    maxPriceNum,
    createdAt: spu.createdAt,
    positioningTagKeys: rawTags.positioningTags,
    categoryName: pickCategoryName(spu),
    priceRangeText: buildPriceRangeText(minPriceNum, maxPriceNum),
    defaultSkuId: pickDefaultSkuId(spu),
    coverImage: base.imageUrl,
    subtitle: displayTags.sellingPoints[0] ?? null,
    isOutOfStock: isSpuOutOfStock(spu.skus),
  };
}

export async function listMiniProgramProductsFromQuery(
  searchParams: URLSearchParams
) {
  const query = normalizeTagQueryFromSearchParams(searchParams);

  const spus = await prisma.productSpu.findMany({
    where: buildSpuWhere(query),
    include: productSpuInclude,
    orderBy: { createdAt: "desc" },
  });

  const filtered: InternalCandidate[] = [];
  for (const spu of spus) {
    const candidate = mapCandidate(spu);
    if (!candidate) continue;

    const rawTags = extractRawTagFields(spu);
    if (
      !matchProductFilters(
        rawTags,
        candidate.minPriceNum,
        candidate.maxPriceNum,
        query.tagFilters,
        query.minPrice,
        query.maxPrice
      )
    ) {
      continue;
    }

    filtered.push(candidate);
  }

  const sorted = sortProducts(
    filtered.map((item) => ({
      minPriceNum: item.minPriceNum,
      maxPriceNum: item.maxPriceNum,
      createdAt: item.createdAt,
      positioningTags: item.positioningTagKeys,
      name: item.name,
      _ref: item,
    })),
    query.sort
  ).map((row) => row._ref);

  const usePagination = query.page != null && query.pageSize != null;
  const pageResult = usePagination
    ? paginateAfterFilter(sorted, query.page!, query.pageSize!)
    : {
        items: sorted,
        page: 1,
        pageSize: sorted.length,
        total: sorted.length,
        totalPages: sorted.length === 0 ? 0 : 1,
      };

  const list = pageResult.items.map(toPublicListItem);
  const inStock = list.filter((p) => !p.isOutOfStock);

  return {
    list,
    products: list,
    inStock,
    total: pageResult.total,
    inStockCount: inStock.length,
    filterCategory: query.categoryId,
    keyword: query.keyword,
    pagination: {
      page: pageResult.page,
      pageSize: pageResult.pageSize,
      total: pageResult.total,
      totalPages: pageResult.totalPages,
    },
    sort: query.sort,
    filters: query.tagFilters,
  };
}

export { normalizeTagQueryFromSearchParams };
