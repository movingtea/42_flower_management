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

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;

export function isClientImageInvalid(stored: string | null | undefined): boolean {
  if (!stored?.trim()) return false;
  const trimmed = stored.trim();
  if (LOCALHOST_PATTERN.test(trimmed)) return true;
  if (trimmed.startsWith("/uploads/") || /^uploads\//i.test(trimmed)) {
    return true;
  }
  return false;
}

/** objectKey 或 legacy https → 可展示的 preview src */
export function resolveClientImagePreview(
  stored: string | null | undefined
): string | null {
  if (!stored?.trim()) return null;
  const trimmed = stored.trim();

  if (isClientImageInvalid(trimmed)) return null;

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const prefix =
    process.env.NEXT_PUBLIC_OSS_OBJECT_PREFIX?.trim() || "universe42";
  if (trimmed.startsWith(`${prefix}/`)) {
    return `${clientPublicBase()}/${trimmed}`;
  }

  if (trimmed.startsWith("/")) {
    return null;
  }

  return null;
}

export const CMS_IMAGE_REUPLOAD_HINT = "图片需要重新上传";
