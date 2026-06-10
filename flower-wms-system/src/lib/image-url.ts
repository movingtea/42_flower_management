/**
 * 图片 URL 存储与 API 输出规范化。
 * - 本地上传：数据库保存 /uploads/xxx 相对路径
 * - 外部 CDN：https 绝对 URL 原样保存
 * - 禁止将 localhost / 127.0.0.1 等开发 origin 持久化
 */

const LOCAL_DEV_HOST_PATTERN = /localhost|127\.0\.0\.1/i;

/** 是否 http(s) 绝对 URL */
export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** 是否包含 localhost / 127.0.0.1 */
export function isLocalhostUrl(value: string): boolean {
  return LOCAL_DEV_HOST_PATTERN.test(value.trim());
}

/** 从 localhost / 127.0.0.1 绝对 URL 提取 pathname，其余原样返回 */
export function stripLocalDevOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (!isAbsoluteUrl(trimmed)) {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  if (!isLocalhostUrl(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    return url.pathname || trimmed;
  } catch {
    const match = trimmed.match(/^https?:\/\/[^/?#]+(\/[^?#]*)?/i);
    return match?.[1] || trimmed;
  }
}

/**
 * 写入数据库前规范化图片路径。
 * - localhost 绝对 URL → /uploads/...
 * - 相对路径补前导 /
 * - 外部 https CDN 保持不变
 */
export function normalizeStoredImagePath(
  value: string | null | undefined
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isAbsoluteUrl(trimmed)) {
    if (isLocalhostUrl(trimmed)) {
      return stripLocalDevOrigin(trimmed);
    }
    return trimmed;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** 非空字符串字段（如 Banner.imageUrl）写入前规范化，空值返回 "" */
export function normalizeStoredImagePathRequired(
  value: string | null | undefined
): string {
  return normalizeStoredImagePath(value) ?? "";
}

export type ToPublicImageUrlOptions = {
  /** 非 localhost 的 public base；仅当需要输出绝对 URL 时使用 */
  publicBaseUrl?: string | null;
};

function resolvePublicBaseUrl(explicit?: string | null): string | null {
  const candidate =
    explicit?.trim() ||
    process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim()?.replace(/\/api(\/wechat)?$/i, "") ||
    null;

  if (!candidate) return null;

  const base = candidate.replace(/\/+$/, "");
  if (isLocalhostUrl(base)) return null;
  return base;
}

/**
 * API 返回或前端展示前规范化。
 * 默认返回相对路径（供小程序端 resolveImageUrl 拼接 baseUrl）；
 * 外部 https 保持不变；localhost 绝对 URL 转为相对路径。
 */
export function toPublicImageUrl(
  value: string | null | undefined,
  options?: ToPublicImageUrlOptions
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = stripLocalDevOrigin(trimmed);

  if (isAbsoluteUrl(normalized)) {
    return normalized;
  }

  const relative = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const base = resolvePublicBaseUrl(options?.publicBaseUrl);

  if (base) {
    return `${base}${relative}`;
  }

  return relative;
}

/** 批量规范化字符串数组（如 images[]） */
export function normalizeStoredImagePathList(
  values: string[] | null | undefined
): string[] {
  if (!values?.length) return [];
  return values
    .map((v) => normalizeStoredImagePath(v))
    .filter((v): v is string => Boolean(v));
}

export function toPublicImageUrlList(
  values: string[] | null | undefined,
  options?: ToPublicImageUrlOptions
): string[] {
  if (!values?.length) return [];
  return values
    .map((v) => toPublicImageUrl(v, options))
    .filter((v): v is string => Boolean(v));
}
