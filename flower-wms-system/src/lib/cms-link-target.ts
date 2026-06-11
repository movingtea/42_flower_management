import type { BannerTargetTypeValue, BannerWriteItem } from "@/lib/banner";

/** CMS 跳转目标类型（面向运营用户） */
export type CmsLinkTargetType =
  | "NONE"
  | "PRODUCT"
  | "CATEGORY"
  | "SCENE"
  | "RECOMMENDATION_SLOT"
  | "CUSTOM_URL"
  | "COUPON";

export type CmsLinkTarget = {
  targetType: CmsLinkTargetType;
  productId?: string | null;
  categoryId?: string | null;
  sceneType?: string | null;
  slotKey?: string | null;
  customUrl?: string | null;
  couponCode?: string | null;
};

export const CMS_LINK_TARGET_LABELS: Record<CmsLinkTargetType, string> = {
  NONE: "无跳转",
  PRODUCT: "商品详情",
  CATEGORY: "商品分类",
  SCENE: "场景推荐",
  RECOMMENDATION_SLOT: "推荐位",
  CUSTOM_URL: "自定义链接",
  COUPON: "优惠券",
};

export const CMS_LINK_TARGET_TYPES: CmsLinkTargetType[] = [
  "NONE",
  "PRODUCT",
  "CATEGORY",
  "SCENE",
  "RECOMMENDATION_SLOT",
  "CUSTOM_URL",
];

const CATEGORY_PATH_RE =
  /^\/pages\/category\/category\?category=([^&]+)/;
const SCENE_PATH_RE =
  /^\/pages\/category\/category\?sceneType=([^&]+)/;
const SLOT_PATH_RE =
  /^\/pages\/index\/index\?slotKey=([^&]+)/;

function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Banner 存储结构 → CMS 跳转目标 */
export function bannerToLinkTarget(item: BannerWriteItem): CmsLinkTarget {
  const targetType = item.targetType;

  if (targetType === "NONE") {
    return { targetType: "NONE" };
  }

  if (targetType === "PRODUCT") {
    return {
      targetType: "PRODUCT",
      productId: item.productId ?? null,
    };
  }

  if (targetType === "COUPON") {
    return {
      targetType: "COUPON",
      couponCode: item.targetParam?.trim() || null,
    };
  }

  const param = item.targetParam?.trim() ?? "";
  if (!param) {
    return { targetType: "NONE" };
  }

  const path = normalizePath(param);
  const categoryMatch = CATEGORY_PATH_RE.exec(path);
  if (categoryMatch) {
    return {
      targetType: "CATEGORY",
      categoryId: decodeURIComponent(categoryMatch[1]),
    };
  }

  const sceneMatch = SCENE_PATH_RE.exec(path);
  if (sceneMatch) {
    return {
      targetType: "SCENE",
      sceneType: decodeURIComponent(sceneMatch[1]),
    };
  }

  const slotMatch = SLOT_PATH_RE.exec(path);
  if (slotMatch) {
    return {
      targetType: "RECOMMENDATION_SLOT",
      slotKey: decodeURIComponent(slotMatch[1]),
    };
  }

  return {
    targetType: "CUSTOM_URL",
    customUrl: param,
  };
}

/** CMS 跳转目标 → Banner 存储字段 */
export function linkTargetToBannerFields(
  target: CmsLinkTarget
): Pick<BannerWriteItem, "targetType" | "productId" | "targetParam"> {
  switch (target.targetType) {
    case "NONE":
      return { targetType: "NONE", productId: null, targetParam: null };
    case "PRODUCT":
      return {
        targetType: "PRODUCT",
        productId: target.productId?.trim() || null,
        targetParam: null,
      };
    case "CATEGORY":
      return {
        targetType: "ACTIVITY" as BannerTargetTypeValue,
        productId: null,
        targetParam: target.categoryId
          ? `/pages/category/category?category=${encodeURIComponent(target.categoryId)}`
          : null,
      };
    case "SCENE":
      return {
        targetType: "ACTIVITY" as BannerTargetTypeValue,
        productId: null,
        targetParam: target.sceneType
          ? `/pages/category/category?sceneType=${encodeURIComponent(target.sceneType)}`
          : null,
      };
    case "RECOMMENDATION_SLOT":
      return {
        targetType: "ACTIVITY" as BannerTargetTypeValue,
        productId: null,
        targetParam: target.slotKey
          ? `/pages/index/index?slotKey=${encodeURIComponent(target.slotKey)}`
          : null,
      };
    case "CUSTOM_URL":
      return {
        targetType: "ACTIVITY" as BannerTargetTypeValue,
        productId: null,
        targetParam: target.customUrl?.trim() || null,
      };
    case "COUPON":
      return {
        targetType: "COUPON",
        productId: null,
        targetParam: target.couponCode?.trim() || null,
      };
    default:
      return { targetType: "NONE", productId: null, targetParam: null };
  }
}

/** 旧 Banner 跳转数据无法映射到选择器时给出提示 */
export function getBannerLinkTargetLegacyWarning(
  item: BannerWriteItem
): string | null {
  const targetType = item.targetType;
  if (targetType === "NONE" || targetType === "PRODUCT" || targetType === "COUPON") {
    return null;
  }

  const param = item.targetParam?.trim() ?? "";
  if (!param) {
    return "当前跳转目标为历史数据，建议重新选择。";
  }

  const parsed = bannerToLinkTarget(item);
  if (
    targetType === "ACTIVITY" &&
    parsed.targetType === "CUSTOM_URL" &&
    !param.startsWith("/pages/") &&
    !param.startsWith("http")
  ) {
    return "当前跳转目标为历史数据，建议重新选择。";
  }

  return null;
}

export function validateCmsLinkTarget(target: CmsLinkTarget): string | null {
  switch (target.targetType) {
    case "PRODUCT":
      if (!target.productId?.trim()) return "请选择跳转商品";
      return null;
    case "CATEGORY":
      if (!target.categoryId?.trim()) return "请选择商品分类";
      return null;
    case "SCENE":
      if (!target.sceneType?.trim()) return "请选择场景";
      return null;
    case "RECOMMENDATION_SLOT":
      if (!target.slotKey?.trim()) return "请选择推荐位";
      return null;
    case "CUSTOM_URL":
      if (!target.customUrl?.trim()) return "请填写自定义链接";
      return null;
    case "COUPON":
      if (!target.couponCode?.trim()) return "请填写优惠券码";
      return null;
    default:
      return null;
  }
}
