import { isLocalhostUrl, toPublicImageUrl } from "@/lib/image-url";

export type BannerProductPayload = {
  id: string;
  name: string;
  sku: string;
  sellPrice: string;
  imageUrl: string | null;
  images: string[];
};

export type BannerInput = {
  id: string;
  imageUrl: string;
  sortOrder: number;
  createdAt?: string | Date;
  isActive: boolean;
  /** 软删除：当前实现以 isActive=false 表示 */
  isDeleted?: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  targetType: string;
  targetParam?: string | null;
  productId?: string | null;
  note?: string | null;
  internalRemark?: string | null;
};

export type WechatBannerOutput = {
  id: string;
  imageUrl: string;
  sort: number;
  targetType: string;
  targetParam: string | null;
  productId: string | null;
  product: BannerProductPayload | null;
};

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function normalizeBannerImageUrl(imageUrl: string): string | null {
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (isLocalhostUrl(trimmed)) {
    const normalized = toPublicImageUrl(trimmed);
    if (!normalized || isLocalhostUrl(normalized)) return null;
    return normalized;
  }
  const publicUrl = toPublicImageUrl(trimmed) ?? trimmed;
  if (!publicUrl || isLocalhostUrl(publicUrl)) return null;
  return publicUrl;
}

function isBannerVisible(input: BannerInput, now: Date): boolean {
  if (!input.isActive || input.isDeleted) return false;
  const nowMs = now.getTime();
  const startsMs = toTime(input.startsAt);
  const endsMs = toTime(input.endsAt);
  if (startsMs != null && nowMs < startsMs) return false;
  if (endsMs != null && nowMs > endsMs) return false;
  return true;
}

function stableSortBanners<T extends { sortOrder: number; createdAt?: string | Date; id: string }>(
  banners: T[]
): T[] {
  return [...banners].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aCreated = toTime(a.createdAt) ?? 0;
    const bCreated = toTime(b.createdAt) ?? 0;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  });
}

export type FilterBannersOptions = {
  now?: Date;
  resolveProduct?: (
    banner: BannerInput
  ) => BannerProductPayload | null | undefined;
};

/**
 * 小程序首页 Banner 安全过滤：active / 有效期内 / 无 localhost / 剥离内部字段。
 */
export function filterHomeBannersForMiniprogram(
  banners: BannerInput[],
  options: FilterBannersOptions = {}
): WechatBannerOutput[] {
  const now = options.now ?? new Date();
  const resolveProduct = options.resolveProduct ?? (() => null);

  const visible = stableSortBanners(
    banners.filter((banner) => isBannerVisible(banner, now))
  );

  const out: WechatBannerOutput[] = [];

  for (const banner of visible) {
    const imageUrl = normalizeBannerImageUrl(banner.imageUrl);
    if (!imageUrl) continue;

    let targetType = banner.targetType?.trim() || "NONE";
    let targetParam = banner.targetParam?.trim() || null;
    let productId = banner.productId;
    let product: BannerProductPayload | null = null;

    if (targetType === "PRODUCT" && productId) {
      const resolved = resolveProduct(banner);
      if (!resolved) {
        targetType = "NONE";
        targetParam = null;
        productId = null;
      } else {
        product = resolved;
      }
    }

    out.push({
      id: banner.id,
      imageUrl,
      sort: banner.sortOrder,
      targetType,
      targetParam,
      productId: productId ?? null,
      product,
    });

    void banner.note;
    void banner.internalRemark;
  }

  return out;
}
