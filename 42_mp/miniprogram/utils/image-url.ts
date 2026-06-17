/**
 * 小程序业务图片 URL 规范化（OSS objectKey → public URL）。
 * 本地 tabBar / assets 图标不走 OSS。
 */
import {
  baseUrl,
  ossObjectPrefix,
  ossPublicBaseUrl,
} from '../config/index';

/** Next 托管占位图（非 OSS） */
export const placeholderImagePath = '/images/product-placeholder.svg';

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;

function trimBase(value: string): string {
  return value.replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isLegacyUploadPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('/uploads/')) return true;
  if (/^uploads\//i.test(trimmed)) return true;
  if (LOCALHOST_PATTERN.test(trimmed) && trimmed.includes('/uploads/')) {
    return true;
  }
  return false;
}

function isInvalidRemoteImage(value: string): boolean {
  if (LOCALHOST_PATTERN.test(value)) return true;
  return isLegacyUploadPath(value);
}

function isOssObjectKey(value: string): boolean {
  const trimmed = value.trim();
  const prefix = ossObjectPrefix.replace(/\/+$/, '');
  if (!trimmed || trimmed.startsWith('/')) return false;
  if (trimmed.includes('..') || isAbsoluteHttpUrl(trimmed)) return false;
  if (LOCALHOST_PATTERN.test(trimmed)) return false;
  return trimmed.startsWith(`${prefix}/`);
}

function isPublicOssUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  const base = trimBase(ossPublicBaseUrl);
  return trimmed === base || trimmed.startsWith(`${base}/`);
}

/** 小程序包内或 Next 静态资源，不应拼接 OSS */
export function isLocalMiniProgramAsset(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/images/')) return true;
  if (trimmed.startsWith('/assets/')) return true;
  if (/^\.\.\/\.\.\/assets\//.test(trimmed)) return true;
  if (/^assets\//.test(trimmed)) return true;
  if (trimmed.startsWith('wxfile://')) return true;
  return false;
}

function resolveSiteAssetUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${trimBase(baseUrl)}${normalized}`;
}

function objectKeyToPublicUrl(objectKey: string): string {
  return `${trimBase(ossPublicBaseUrl)}/${objectKey.replace(/^\/+/, '')}`;
}

/**
 * 业务远程图片 → 可直接用于 `<image src>` 的完整 URL。
 * OSS objectKey / OSS public URL / 外部 https 保持可用；localhost / uploads 返回占位。
 */
export function normalizeImageUrl(src?: string | null): string {
  if (src == null) return resolveSiteAssetUrl(placeholderImagePath);

  const trimmed = String(src).trim();
  if (!trimmed) return resolveSiteAssetUrl(placeholderImagePath);

  if (isLocalMiniProgramAsset(trimmed)) {
    return trimmed.startsWith('/') ? resolveSiteAssetUrl(trimmed) : trimmed;
  }

  if (isInvalidRemoteImage(trimmed)) {
    console.warn('[image-url] invalid remote image rejected:', trimmed);
    return resolveSiteAssetUrl(placeholderImagePath);
  }

  if (isPublicOssUrl(trimmed)) {
    return trimBase(trimmed) === trimBase(ossPublicBaseUrl)
      ? resolveSiteAssetUrl(placeholderImagePath)
      : trimmed;
  }

  if (isAbsoluteHttpUrl(trimmed)) {
    return trimmed;
  }

  if (isOssObjectKey(trimmed)) {
    return objectKeyToPublicUrl(trimmed);
  }

  // 历史错误：pathname 形如 /universe42/products/...
  const slashKey = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (isOssObjectKey(slashKey)) {
    return objectKeyToPublicUrl(slashKey);
  }

  if (trimmed.startsWith('/')) {
    return resolveSiteAssetUrl(trimmed);
  }

  console.warn('[image-url] unrecognized image value:', trimmed);
  return resolveSiteAssetUrl(placeholderImagePath);
}

export function normalizeImageUrlList(urls: string[]): string[] {
  return urls.map((u) => normalizeImageUrl(u));
}
