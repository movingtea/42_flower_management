import type { BannerTargetType } from "@/generated/prisma/enums";

export const BANNER_TARGET_TYPES = [
  "PRODUCT",
  "ACTIVITY",
  "COUPON",
  "NONE",
] as const satisfies readonly BannerTargetType[];

export type BannerTargetTypeValue = (typeof BANNER_TARGET_TYPES)[number];

export const BANNER_TARGET_TYPE_LABELS: Record<BannerTargetTypeValue, string> = {
  PRODUCT: "跳转商品",
  ACTIVITY: "活动页",
  COUPON: "优惠券",
  NONE: "不跳转",
};

export type BannerWriteItem = {
  id?: string;
  imageUrl: string;
  sortOrder: number;
  targetType: BannerTargetTypeValue;
  targetParam?: string | null;
  productId?: string | null;
  isActive?: boolean;
};

export type WechatBannerPayload = {
  id: string;
  imageUrl: string;
  sort: number;
  targetType: BannerTargetTypeValue;
  targetParam: string | null;
  productId: string | null;
  product: {
    id: string;
    name: string;
    sku: string;
    sellPrice: string;
    imageUrl: string | null;
    images: string[];
  } | null;
};

export function parseBannerTargetType(raw: unknown): BannerTargetTypeValue {
  if (typeof raw === "string") {
    const upper = raw.trim().toUpperCase();
    if (BANNER_TARGET_TYPES.includes(upper as BannerTargetTypeValue)) {
      return upper as BannerTargetTypeValue;
    }
  }
  return "NONE";
}

export function validateBannerWriteItem(
  item: BannerWriteItem,
  index: number
): string | null {
  if (!item.imageUrl.trim()) {
    return `第 ${index + 1} 条轮播须上传海报图`;
  }
  if (!Number.isFinite(item.sortOrder)) {
    return `第 ${index + 1} 条轮播排序须为数字`;
  }

  const targetType = parseBannerTargetType(item.targetType);

  if (targetType === "PRODUCT") {
    if (!item.productId?.trim()) {
      return `第 ${index + 1} 条轮播选择「跳转商品」时须指定商品`;
    }
  }

  if (targetType === "ACTIVITY" || targetType === "COUPON") {
    if (!item.targetParam?.trim()) {
      return `第 ${index + 1} 条轮播须填写跳转参数`;
    }
  }

  return null;
}

export function validateBannerWriteItems(items: BannerWriteItem[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const err = validateBannerWriteItem(items[i], i);
    if (err) return err;
  }
  return null;
}
