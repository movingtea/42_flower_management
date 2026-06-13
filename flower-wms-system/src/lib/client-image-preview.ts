/**
 * 客户端 CMS 图片预览（读取 NEXT_PUBLIC_OSS_PUBLIC_BASE_URL）。
 * 数据库存 objectKey；展示时拼接 public URL。
 */

const DEFAULT_PUBLIC_BASE = "https://oss.universe42.studio";

function clientPublicBase(): string {
  return (
    process.env.NEXT_PUBLIC_OSS_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_ALIYUN_OSS_PUBLIC_BASE_URL?.trim() ||
    DEFAULT_PUBLIC_BASE
  ).replace(/\/+$/, "");
}

function clientObjectPrefix(): string {
  return process.env.NEXT_PUBLIC_OSS_OBJECT_PREFIX?.trim() || "universe42";
}

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;

export function isLegacyUploadPathClient(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/uploads/")) return true;
  if (/^uploads\//i.test(trimmed)) return true;
  if (LOCALHOST_PATTERN.test(trimmed) && trimmed.includes("/uploads/")) {
    return true;
  }
  return false;
}

export function isOssObjectKeyClient(value: string): boolean {
  const trimmed = value.trim();
  const prefix = clientObjectPrefix();
  if (!trimmed || trimmed.startsWith("/")) return false;
  if (trimmed.includes("..") || /^https?:\/\//i.test(trimmed)) return false;
  if (LOCALHOST_PATTERN.test(trimmed)) return false;
  return trimmed.startsWith(`${prefix}/`);
}

export function isPublicOssUrlClient(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  const base = clientPublicBase();
  return trimmed === base || trimmed.startsWith(`${base}/`);
}

export function isClientImageInvalid(
  stored: string | null | undefined
): boolean {
  if (!stored?.trim()) return false;
  const trimmed = stored.trim();
  if (LOCALHOST_PATTERN.test(trimmed)) return true;
  if (isLegacyUploadPathClient(trimmed)) return true;
  return false;
}

/** objectKey 或 OSS public URL → 可展示的 preview src */
export function resolveClientImagePreview(
  stored: string | null | undefined
): string | null {
  return getClientPreviewImageUrl(stored);
}

/** 与 resolveClientImagePreview 同义，供 Sprint 17 规范引用 */
export function getClientPreviewImageUrl(
  stored: string | null | undefined
): string | null {
  if (!stored?.trim()) return null;
  const trimmed = stored.trim();

  if (isClientImageInvalid(trimmed)) return null;

  if (isPublicOssUrlClient(trimmed)) {
    return trimmed;
  }

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (isOssObjectKeyClient(trimmed)) {
    return `${clientPublicBase()}/${trimmed}`;
  }

  if (trimmed.startsWith("/")) {
    return null;
  }

  return null;
}

export const CMS_IMAGE_REUPLOAD_HINT = "图片需要重新上传";
export const CMS_IMAGE_INVALID_LOAD_HINT = "图片加载失败，请重新上传";
