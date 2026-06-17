import { toPublicImageUrl } from "@/lib/image-url";

/** 需要规范化输出的字符串字段名 */
const IMAGE_STRING_KEYS = new Set([
  "imageUrl",
  "coverImage",
  "thumbnail",
  "thumbUrl",
  "avatarUrl",
  "bannerUrl",
  "detailImage",
  "mainImage",
  "mainImageUrl",
  "picUrl",
  "snapshotProductImage",
  "snapshotImageUrl",
  "imageOverride",
]);

/** 图片 URL 字符串数组字段名 */
const IMAGE_ARRAY_KEYS = new Set([
  "images",
  "imageList",
  "gallery",
  "bannerImages",
]);

/** @deprecated 小程序 API 不再拼接 localhost；请使用 toPublicImageUrl */
export function getAssetBaseUrl(): string {
  const asset = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim();
  if (asset) {
    return asset.replace(/\/+$/, "");
  }

  const api = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (api) {
    return api
      .replace(/\/+$/, "")
      .replace(/\/api\/wechat$/i, "")
      .replace(/\/api$/i, "");
  }

  return "http://localhost:3000";
}

/** @deprecated 请使用 getAssetBaseUrl */
export function getWechatApiBaseUrl(): string {
  return getAssetBaseUrl();
}

/**
 * 小程序 API 图片字段规范化：剥离 localhost，本地路径保持相对，外部 CDN 保持绝对。
 * 不再默认拼接 http://localhost:3000。
 */
export function resolveImageUrl(
  value: string | null | undefined
): string | null | undefined {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  const out = toPublicImageUrl(value);
  if (out) return out;
  const trimmed = value.trim();
  return trimmed || null;
}

function formatImageArray(value: unknown): unknown {
  if (!Array.isArray(value)) return walkUnknown(value);
  return value.map((item) => {
    if (typeof item === "string") {
      return resolveImageUrl(item);
    }
    return walkUnknown(item);
  });
}

function walkUnknown(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walkUnknown(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (IMAGE_ARRAY_KEYS.has(key)) {
        out[key] = formatImageArray(val);
        continue;
      }

      if (IMAGE_STRING_KEYS.has(key) && typeof val === "string") {
        out[key] = resolveImageUrl(val);
        continue;
      }

      out[key] = walkUnknown(val);
    }

    return out;
  }

  return value;
}

/**
 * 深度清洗 JSON 结构中的图片路径，供 /api/miniprogram/* 下发前使用。
 * 返回新对象，不修改入参引用。
 */
export function imageUrlFormatter<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  const cloned = JSON.parse(JSON.stringify(input)) as T;
  return walkUnknown(cloned) as T;
}
