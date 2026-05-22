/** AppConfig.key：小程序首页轮播 */
export const HOME_BANNER_KEY = "HOME_BANNER";

export const HOME_BANNER_NAME = "小程序首页轮播";

export type HomeBannerItem = {
  id: string;
  imageUrl: string;
  sort: number;
  productId: string;
};

export function createBannerId(): string {
  return `bn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function parseHomeBannerValue(value: unknown): HomeBannerItem[] {
  if (!Array.isArray(value)) return [];

  const items: HomeBannerItem[] = [];

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl.trim() : "";
    const productId =
      typeof r.productId === "string" ? r.productId.trim() : "";
    const sort = Number(r.sort);
    const id =
      typeof r.id === "string" && r.id.trim()
        ? r.id.trim()
        : createBannerId();

    if (!imageUrl || !productId || !Number.isFinite(sort)) continue;

    items.push({
      id,
      imageUrl,
      productId,
      sort: Math.round(sort),
    });
  }

  return sortHomeBannerItems(items);
}

export function sortHomeBannerItems(items: HomeBannerItem[]): HomeBannerItem[] {
  return [...items].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export function validateHomeBannerItems(items: HomeBannerItem[]): string | null {
  if (items.length === 0) return null;

  for (const item of items) {
    if (!item.imageUrl) return "每条轮播须上传海报图";
    if (!item.productId) return "每条轮播须选择跳转商品";
    if (!Number.isFinite(item.sort)) return "排序号须为数字";
  }

  return null;
}
