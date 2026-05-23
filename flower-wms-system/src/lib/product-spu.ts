import type { Prisma } from "@/generated/prisma/client";

export type ProductSkuCard = {
  id: string;
  skuCode: string;
  specName: string;
  price: Prisma.Decimal | { toString(): string };
  stock: number;
  imageUrl: string | null;
  isMainImage: boolean;
};

/** 商品卡片封面图：主图 SKU > 单 SKU > 首个 SKU */
export function resolveSpuCardImageUrl(skus: ProductSkuCard[]): string {
  if (skus.length === 0) return "";

  const main = skus.find((s) => s.isMainImage && s.imageUrl?.trim());
  if (main?.imageUrl) return main.imageUrl.trim();

  if (skus.length === 1) {
    return skus[0].imageUrl?.trim() ?? "";
  }

  return skus[0].imageUrl?.trim() ?? "";
}

export function resolveSpuMinPrice(skus: ProductSkuCard[]): number {
  if (skus.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const sku of skus) {
    const p = Number(sku.price);
    if (Number.isFinite(p) && p < min) min = p;
  }
  return Number.isFinite(min) ? min : 0;
}

export function resolveSpuMaxPrice(skus: ProductSkuCard[]): number {
  if (skus.length === 0) return 0;
  let max = 0;
  for (const sku of skus) {
    const p = Number(sku.price);
    if (Number.isFinite(p) && p > max) max = p;
  }
  return max;
}

/** 详情轮播：主图 SKU 优先，再合并其余款式图（去重） */
export function resolveSpuBannerImages(skus: ProductSkuCard[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const u = raw?.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const main = skus.find((s) => s.isMainImage);
  if (main) push(main.imageUrl);

  for (const sku of skus) {
    push(sku.imageUrl);
  }

  return urls;
}

export function isSpuOutOfStock(skus: ProductSkuCard[]): boolean {
  if (skus.length === 0) return true;
  return skus.every((s) => s.stock <= 0);
}

export function formatMinPriceLabel(
  minPrice: number,
  skuCount: number
): { displayPrice: string; priceSuffix: string } {
  const displayPrice = minPrice.toFixed(2);
  return {
    displayPrice,
    priceSuffix: skuCount > 1 ? "起" : "",
  };
}

export const productSpuInclude = {
  categories: { include: { productCategory: true } },
  skus: { orderBy: { sortOrder: "asc" as const } },
} as const;

export type ProductSpuWithRelations = Prisma.ProductSpuGetPayload<{
  include: typeof productSpuInclude;
}>;
