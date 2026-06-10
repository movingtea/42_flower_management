import { toRelativeImagePath, toRelativeImagePathList } from './image';

/** 小程序端 SPU 列表项（与 GET /api/miniprogram/products 对齐） */
export interface WechatProductSku {
  id: string;
  skuCode: string;
  specName: string;
  price: string;
  stock: number;
  /** 展现用富文本（API 已做 SPU Fallback） */
  description?: string | null;
  imageUrl: string | null;
  isMainImage: boolean;
}

export interface WechatProductTagDisplay {
  key: string;
  label: string;
}

export interface WechatProductRaw {
  id: string;
  name: string;
  description?: string | null;
  maintenanceGuide?: string | null;
  mainImageUrl?: string;
  subtitle?: string;
  minPrice?: string;
  sellPrice?: string;
  priceSuffix?: string;
  price?: number | string;
  shippingFee?: number;
  imageUrl?: string;
  images?: string[];
  isOutOfStock?: boolean;
  skus?: WechatProductSku[];
  occasionTags?: WechatProductTagDisplay[];
  colorTags?: WechatProductTagDisplay[];
  styleTags?: WechatProductTagDisplay[];
  relationshipTags?: WechatProductTagDisplay[];
  budgetTags?: WechatProductTagDisplay[];
  positioningTags?: WechatProductTagDisplay[];
  sellingPoints?: string[];
}

export interface WechatProductItem {
  id: string;
  name: string;
  subtitle?: string;
  price: string;
  priceSuffix: string;
  shippingFee: number;
  imageUrl: string;
  isOutOfStock?: boolean;
  skus: WechatProductSku[];
  occasionTags: WechatProductTagDisplay[];
  colorTags: WechatProductTagDisplay[];
  styleTags: WechatProductTagDisplay[];
  relationshipTags: WechatProductTagDisplay[];
  budgetTags: WechatProductTagDisplay[];
  positioningTags: WechatProductTagDisplay[];
  sellingPoints: string[];
  /** 卡片展示用标签（已截断） */
  cardOccasionLabels: string[];
  cardStyleColorLabels: string[];
  cardSellingPoint: string;
}

export function normalizeWechatProduct(item: WechatProductRaw): WechatProductItem {
  const spuDescription = item.description?.trim() || null;
  const spuMainImage =
    item.mainImageUrl?.trim() ||
    item.imageUrl?.trim() ||
    (item.images && item.images.length > 0 ? item.images[0] : '') ||
    '';

  const rawSkus = Array.isArray(item.skus) ? item.skus : [];
  const skus = rawSkus.map((s) => {
    const ownDescription = s.description?.trim() || null;
    const ownImage = s.imageUrl?.trim() || null;
    return {
      ...s,
      description: ownDescription ?? spuDescription,
      imageUrl: ownImage
        ? toRelativeImagePath(ownImage)
        : spuMainImage
          ? toRelativeImagePath(spuMainImage)
          : null,
    };
  });
  const price =
    item.minPrice ??
    item.sellPrice ??
    (item.price != null ? String(item.price) : '0');
  const priceSuffix = item.priceSuffix ?? (skus.length > 1 ? '起' : '');
  const rawCover =
    item.mainImageUrl ??
    item.imageUrl ??
    (item.images && item.images.length > 0 ? item.images[0] : '');
  const imageUrl = toRelativeImagePath(rawCover);

  const occasionTags = Array.isArray(item.occasionTags) ? item.occasionTags : [];
  const colorTags = Array.isArray(item.colorTags) ? item.colorTags : [];
  const styleTags = Array.isArray(item.styleTags) ? item.styleTags : [];
  const relationshipTags = Array.isArray(item.relationshipTags)
    ? item.relationshipTags
    : [];
  const budgetTags = Array.isArray(item.budgetTags) ? item.budgetTags : [];
  const positioningTags = Array.isArray(item.positioningTags)
    ? item.positioningTags
    : [];
  const sellingPoints = Array.isArray(item.sellingPoints)
    ? item.sellingPoints.filter((s) => typeof s === 'string' && s.trim())
    : [];

  const cardOccasionLabels = occasionTags.slice(0, 2).map((t) => t.label || t.key);
  const cardStyleColorLabels = [
    ...colorTags.slice(0, 1),
    ...styleTags.slice(0, 1),
  ].map((t) => t.label || t.key);
  const cardSellingPoint = sellingPoints[0] ?? '';

  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    price,
    priceSuffix,
    shippingFee: Math.max(0, Number(item.shippingFee) || 0),
    imageUrl,
    isOutOfStock: item.isOutOfStock,
    skus,
    occasionTags,
    colorTags,
    styleTags,
    relationshipTags,
    budgetTags,
    positioningTags,
    sellingPoints,
    cardOccasionLabels,
    cardStyleColorLabels,
    cardSellingPoint,
  };
}

export function pickDefaultSku(product: WechatProductItem): WechatProductSku | null {
  if (!product.skus.length) return null;
  if (product.skus.length === 1) return product.skus[0];
  const main = product.skus.find((s) => s.isMainImage);
  return main ?? product.skus[0];
}

export function isSkuSelectable(sku: WechatProductSku): boolean {
  return sku.stock > 0;
}

/** 详情页价格：同款同价 ¥128；多价 ¥128 - ¥399 */
export function computePriceRange(skus: WechatProductSku[]): {
  minPrice: string;
  maxPrice: string;
  priceLabel: string;
} {
  if (!skus.length) {
    return { minPrice: '0.00', maxPrice: '0.00', priceLabel: '¥0.00' };
  }

  const values = skus
    .map((s) => parseFloat(String(s.price)))
    .filter((n) => Number.isFinite(n));

  if (!values.length) {
    return { minPrice: '0.00', maxPrice: '0.00', priceLabel: '¥0.00' };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const minPrice = min.toFixed(2);
  const maxPrice = max.toFixed(2);
  const priceLabel =
    minPrice === maxPrice ? `¥${minPrice}` : `¥${minPrice} - ¥${maxPrice}`;

  return { minPrice, maxPrice, priceLabel };
}

export function buildBannerImages(
  skus: WechatProductSku[],
  fallbackUrl: string
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const u = (raw ?? '').trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const main = skus.find((s) => s.isMainImage);
  if (main) push(main.imageUrl);
  skus.forEach((s) => push(s.imageUrl));
  if (!urls.length && fallbackUrl) push(fallbackUrl);

  return toRelativeImagePathList(urls);
}

/** 从商品池中随机抽取 n 款（排除当前 SPU） */
export function pickRandomRecommendations<T extends { id: string }>(
  pool: T[],
  currentId: string,
  count: number
): T[] {
  const candidates = pool.filter((p) => p.id !== currentId);
  if (candidates.length <= count) {
    return [...candidates];
  }

  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}
