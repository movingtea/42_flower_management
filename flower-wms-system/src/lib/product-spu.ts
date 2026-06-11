import type { Prisma } from "@/generated/prisma/client";
import {
  filterActiveSkus,
  type SkuStockInput,
} from "@/services/miniprogram-stock-pure";

export type ProductSkuCard = {
  id: string;
  skuCode: string;
  specName: string;
  price: Prisma.Decimal | { toString(): string };
  stock: number;
  isActive?: boolean;
  imageUrl: string | null;
  isMainImage: boolean;
};

/** 商品卡片封面图：主图 SKU > 单 SKU > 首个 SKU（优先 active SKU） */
export function resolveSpuCardImageUrl(skus: ProductSkuCard[]): string {
  const activeSkus = filterActiveSkus(skus);
  const pool = activeSkus.length > 0 ? activeSkus : skus;
  if (pool.length === 0) return "";

  const main = pool.find((s) => s.isMainImage && s.imageUrl?.trim());
  if (main?.imageUrl) return main.imageUrl.trim();

  if (pool.length === 1) {
    return pool[0].imageUrl?.trim() ?? "";
  }

  return pool[0].imageUrl?.trim() ?? "";
}

export function resolveSpuMinPrice(skus: ProductSkuCard[]): number {
  const activeSkus = filterActiveSkus(skus);
  const pool = activeSkus.length > 0 ? activeSkus : skus;
  if (pool.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const sku of pool) {
    const p = Number(sku.price);
    if (Number.isFinite(p) && p < min) min = p;
  }
  return Number.isFinite(min) ? min : 0;
}

export function resolveSpuMaxPrice(skus: ProductSkuCard[]): number {
  const activeSkus = filterActiveSkus(skus);
  const pool = activeSkus.length > 0 ? activeSkus : skus;
  if (pool.length === 0) return 0;
  let max = 0;
  for (const sku of pool) {
    const p = Number(sku.price);
    if (Number.isFinite(p) && p > max) max = p;
  }
  return max;
}

/** 详情轮播：主图 SKU 优先，再合并其余款式图（去重；优先 active SKU） */
export function resolveSpuBannerImages(skus: ProductSkuCard[]): string[] {
  const activeSkus = filterActiveSkus(skus);
  const pool = activeSkus.length > 0 ? activeSkus : skus;
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const u = raw?.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const main = pool.find((s) => s.isMainImage);
  if (main) push(main.imageUrl);

  for (const sku of pool) {
    push(sku.imageUrl);
  }

  return urls;
}

/** 是否售罄：仅当存在 active SKU 且其 stock 全部为 0；无 active SKU 视为不可售 */
export function isSpuOutOfStock(skus: ReadonlyArray<SkuStockInput>): boolean {
  const activeSkus = filterActiveSkus(skus);
  if (activeSkus.length === 0) return true;
  return activeSkus.every((s) => s.stock <= 0);
}

export { filterActiveSkus, hasActiveSku } from "@/services/miniprogram-stock-pure";

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
