import { isLocalhostUrl, toPublicImageUrl } from "@/lib/image-url";
import {
  filterActiveSkus,
  hasActiveSku,
} from "@/services/miniprogram-stock-pure";

export type RecommendationSkuInput = {
  id: string;
  stock: number;
  isActive?: boolean;
  specName: string;
  price: string | number;
  imageUrl?: string | null;
  isMainImage?: boolean;
};

export type RecommendationProductInput = {
  id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
  description?: string | null;
  operationNote?: string | null;
  skus: RecommendationSkuInput[];
  occasionTags?: unknown;
  colorTags?: unknown;
  styleTags?: unknown;
  sellingPoints?: unknown;
};

export type RecommendationItemInput = {
  id: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string | Date;
  startAt?: Date | null;
  endAt?: Date | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  imageOverride?: string | null;
  skuId?: string | null;
  note?: string | null;
  product: RecommendationProductInput;
};

export type RecommendationSlotInput = {
  id: string;
  key: string;
  name: string;
  slotType: string;
  sceneType: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string | Date;
  items: RecommendationItemInput[];
};

export type MiniprogramRecommendationItemOutput = {
  productId: string;
  skuId: string | null;
  productName: string;
  skuName: string | null;
  price: string;
  coverImage: string;
  subtitle: string | null;
  occasionTags: unknown;
  colorTags: unknown;
  styleTags: unknown;
  sellingPoints: string[];
};

export type MiniprogramRecommendationSlotOutput = {
  key: string;
  name: string;
  slotType: string;
  sceneType: string | null;
  items: MiniprogramRecommendationItemOutput[];
};

const SENSITIVE_ITEM_KEYS = new Set(["note", "operationNote"]);

function toTime(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function isWithinSchedule(
  item: RecommendationItemInput,
  now: Date
): boolean {
  const nowMs = now.getTime();
  const startMs = toTime(item.startAt);
  const endMs = toTime(item.endAt);
  if (startMs != null && nowMs < startMs) return false;
  if (endMs != null && nowMs > endMs) return false;
  return true;
}

/** 推荐位库存判断：只统计 isActive=true 的 SKU */
export function computeActiveSkuTotalStock(
  skus: ReadonlyArray<{ stock: number; isActive?: boolean }>
): number {
  return filterActiveSkus(skus).reduce(
    (sum, sku) => sum + Math.max(0, Math.floor(sku.stock)),
    0
  );
}

export function hasRecommendationSellableStock(
  skus: ReadonlyArray<{ stock: number; isActive?: boolean }>
): boolean {
  return computeActiveSkuTotalStock(skus) > 0;
}

function resolveCoverImage(
  item: RecommendationItemInput,
  sku: RecommendationSkuInput,
  activeSkus: RecommendationSkuInput[]
): string | null {
  const candidates = [
    item.imageOverride,
    sku.imageUrl,
    activeSkus.find((s) => s.isMainImage && s.imageUrl)?.imageUrl,
    activeSkus[0]?.imageUrl,
  ];

  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    if (isLocalhostUrl(trimmed)) {
      const normalized = toPublicImageUrl(trimmed);
      if (normalized && !isLocalhostUrl(normalized)) return normalized;
      continue;
    }
    const publicUrl = toPublicImageUrl(trimmed) ?? trimmed;
    if (publicUrl && !isLocalhostUrl(publicUrl)) return publicUrl;
  }
  return null;
}

function stableSort<T extends { sortOrder: number; createdAt: string | Date; id: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aCreated = toTime(a.createdAt) ?? 0;
    const bCreated = toTime(b.createdAt) ?? 0;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  });
}

function pickSku(
  product: RecommendationProductInput,
  skuId?: string | null
): RecommendationSkuInput | null {
  const activeSkus = filterActiveSkus(product.skus);
  if (!activeSkus.length) return null;
  if (skuId) {
    const matched = activeSkus.find((s) => s.id === skuId);
    if (matched) return matched;
  }
  return (
    activeSkus.find((s) => s.isMainImage) ??
    activeSkus[0] ??
    null
  );
}

function mapItemToOutput(
  item: RecommendationItemInput,
  product: RecommendationProductInput,
  sku: RecommendationSkuInput,
  coverImage: string,
  opTags: {
    occasionTags: unknown;
    colorTags: unknown;
    styleTags: unknown;
    sellingPoints: string[];
  }
): MiniprogramRecommendationItemOutput {
  return {
    productId: product.id,
    skuId: item.skuId ?? sku.id,
    productName: item.titleOverride?.trim() || product.name,
    skuName: sku.specName,
    price: String(sku.price),
    coverImage,
    subtitle: item.subtitleOverride?.trim() || product.description || null,
    occasionTags: opTags.occasionTags,
    colorTags: opTags.colorTags,
    styleTags: opTags.styleTags,
    sellingPoints: opTags.sellingPoints,
  };
}

export type FilterRecommendationOptions = {
  now?: Date;
  buildOperationTags?: (
    product: RecommendationProductInput
  ) => {
    occasionTags: unknown;
    colorTags: unknown;
    styleTags: unknown;
    sellingPoints: string[];
  };
};

/**
 * 小程序推荐位安全过滤：售罄不展示、缺主图不展示、敏感字段剥离、不自动补位。
 */
export function filterRecommendationSlotsForMiniprogram(
  slots: RecommendationSlotInput[],
  options: FilterRecommendationOptions = {}
): MiniprogramRecommendationSlotOutput[] {
  const now = options.now ?? new Date();
  const buildTags =
    options.buildOperationTags ??
    (() => ({
      occasionTags: [],
      colorTags: [],
      styleTags: [],
      sellingPoints: [],
    }));

  const activeSlots = stableSort(slots.filter((slot) => slot.isActive));
  const result: MiniprogramRecommendationSlotOutput[] = [];

  for (const slot of activeSlots) {
    const items: MiniprogramRecommendationItemOutput[] = [];

    for (const item of stableSort(slot.items)) {
      if (!item.isActive) continue;
      if (!isWithinSchedule(item, now)) continue;

      const product = item.product;
      if (!product || product.isDeleted || !product.isActive) continue;
      if (!hasActiveSku(product.skus)) continue;
      if (!hasRecommendationSellableStock(product.skus)) continue;

      const activeSkus = filterActiveSkus(product.skus);
      const sku = pickSku(product, item.skuId);
      if (!sku) continue;

      const coverImage = resolveCoverImage(item, sku, activeSkus);
      if (!coverImage) continue;

      const opTags = buildTags(product);
      items.push(mapItemToOutput(item, product, sku, coverImage, opTags));

      void SENSITIVE_ITEM_KEYS;
      void product.operationNote;
      void item.note;
    }

    if (items.length > 0) {
      result.push({
        key: slot.key,
        name: slot.name,
        slotType: slot.slotType,
        sceneType: slot.sceneType,
        items,
      });
    }
  }

  return result;
}
