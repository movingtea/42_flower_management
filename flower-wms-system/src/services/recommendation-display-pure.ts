import { isLocalhostUrl } from "@/lib/image-url";
import {
  computeActiveSkuTotalStock,
  hasRecommendationSellableStock,
} from "@/services/recommendation-rules-pure";
import { filterActiveSkus, hasActiveSku } from "@/services/miniprogram-stock-pure";

export type RecommendationDisplayStatus =
  | "VISIBLE"
  | "INACTIVE_ITEM"
  | "PRODUCT_OFF_SHELF"
  | "ALL_SKUS_INACTIVE"
  | "PRODUCT_SOLD_OUT"
  | "MISSING_MAIN_IMAGE"
  | "INVALID_IMAGE"
  | "OUT_OF_SCHEDULE";

export type RecommendationDisplayEvaluation = {
  status: RecommendationDisplayStatus;
  label: string;
  visibleOnMiniprogram: boolean;
};

export type RecommendationDisplayItemInput = {
  isActive: boolean;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  imageOverride?: string | null;
  product: {
    isActive: boolean;
    isDeleted?: boolean;
    skus: Array<{
      stock: number;
      isActive?: boolean;
      imageUrl?: string | null;
      isMainImage?: boolean;
    }>;
  };
  now?: Date;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function resolveCoverCandidate(
  item: RecommendationDisplayItemInput
): string | null {
  const override = item.imageOverride?.trim();
  if (override) return override;
  const skus = filterActiveSkus(item.product.skus);
  const main = skus.find((s) => s.isMainImage && s.imageUrl?.trim());
  if (main?.imageUrl) return main.imageUrl.trim();
  const first = skus.find((s) => s.imageUrl?.trim());
  return first?.imageUrl?.trim() ?? null;
}

export function evaluateRecommendationItemDisplayStatus(
  item: RecommendationDisplayItemInput
): RecommendationDisplayEvaluation {
  const now = item.now ?? new Date();
  const nowMs = now.getTime();

  if (!item.isActive) {
    return {
      status: "INACTIVE_ITEM",
      label: "推荐项已停用，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  const startMs = toMs(item.startAt);
  const endMs = toMs(item.endAt);
  if (startMs != null && nowMs < startMs) {
    return {
      status: "OUT_OF_SCHEDULE",
      label: "未到展示时间，前台不展示",
      visibleOnMiniprogram: false,
    };
  }
  if (endMs != null && nowMs > endMs) {
    return {
      status: "OUT_OF_SCHEDULE",
      label: "已过展示时间，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  const product = item.product;
  if (product.isDeleted || !product.isActive) {
    return {
      status: "PRODUCT_OFF_SHELF",
      label: "商品已下架，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  if (!hasActiveSku(product.skus)) {
    return {
      status: "ALL_SKUS_INACTIVE",
      label: "所有规格已停用，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  if (!hasRecommendationSellableStock(product.skus)) {
    return {
      status: "PRODUCT_SOLD_OUT",
      label: "商品已售罄，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  const cover = resolveCoverCandidate(item);
  if (!cover) {
    return {
      status: "MISSING_MAIN_IMAGE",
      label: "缺少主图，前台不展示",
      visibleOnMiniprogram: false,
    };
  }

  if (isLocalhostUrl(cover)) {
    return {
      status: "INVALID_IMAGE",
      label: "图片路径异常，前台可能无法展示",
      visibleOnMiniprogram: false,
    };
  }

  void computeActiveSkuTotalStock;

  return {
    status: "VISIBLE",
    label: "可展示",
    visibleOnMiniprogram: true,
  };
}
