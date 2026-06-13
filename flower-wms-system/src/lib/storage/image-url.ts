/**
 * 图片 objectKey / public URL 纯函数（可单测，不依赖 OSS SDK）。
 */

export type ImageUrlEnv = {
  objectPrefix: string;
  publicBaseUrl: string;
  enableLegacyUploads: boolean;
  blockLocalhostImageUrl: boolean;
  normalizeLocalhostUploads: boolean;
};

const LOCAL_DEV_HOST_PATTERN = /localhost|127\.0\.0\.1/i;

export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isLocalhostUrl(value: string): boolean {
  return LOCAL_DEV_HOST_PATTERN.test(value.trim());
}

export function isLegacyUploadPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/uploads/")) return true;
  if (/^uploads\//i.test(trimmed)) return true;
  if (isLocalhostUrl(trimmed) && trimmed.includes("/uploads/")) return true;
  return false;
}

export function isOssObjectKey(
  value: string,
  objectPrefix = "universe42"
): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  if (trimmed.includes("..") || /^https?:\/\//i.test(trimmed)) return false;
  if (/localhost/i.test(trimmed)) return false;
  const prefix = objectPrefix.replace(/\/+$/, "");
  return trimmed.startsWith(`${prefix}/`);
}

export function isPublicOssUrl(
  value: string,
  publicBaseUrl: string
): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return false;
  const base = publicBaseUrl.replace(/\/+$/, "");
  return trimmed === base || trimmed.startsWith(`${base}/`);
}

export function isInvalidLocalImageUrl(
  value: string,
  env: Pick<ImageUrlEnv, "blockLocalhostImageUrl" | "enableLegacyUploads">
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (env.blockLocalhostImageUrl && isLocalhostUrl(trimmed)) {
    return true;
  }

  if (!env.enableLegacyUploads && isLegacyUploadPath(trimmed)) {
    return true;
  }

  return false;
}

/** CMS 是否需要提示重新上传 */
export function needsImageReupload(
  value: string | null | undefined,
  env: Pick<ImageUrlEnv, "blockLocalhostImageUrl" | "enableLegacyUploads">
): boolean {
  if (!value?.trim()) return false;
  return isInvalidLocalImageUrl(value, env);
}

function extractObjectKeyFromPublicUrl(
  value: string,
  publicBaseUrl: string,
  objectPrefix: string
): string | null {
  const base = publicBaseUrl.replace(/\/+$/, "");
  const trimmed = value.trim();
  if (!trimmed.startsWith(`${base}/`)) return null;
  const key = trimmed.slice(base.length + 1);
  return isOssObjectKey(key, objectPrefix) ? key : null;
}

/**
 * 写入数据库前规范化：优先保存 objectKey。
 */
export function normalizeImageValue(
  value: string | null | undefined,
  env: ImageUrlEnv
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isInvalidLocalImageUrl(trimmed, env)) {
    return null;
  }

  if (isOssObjectKey(trimmed, env.objectPrefix)) {
    return trimmed;
  }

  if (isPublicOssUrl(trimmed, env.publicBaseUrl)) {
    return extractObjectKeyFromPublicUrl(trimmed, env.publicBaseUrl, env.objectPrefix);
  }

  if (isLegacyUploadPath(trimmed)) {
    if (!env.enableLegacyUploads) return null;
    if (env.normalizeLocalhostUploads && isLocalhostUrl(trimmed)) {
      try {
        const url = new URL(trimmed);
        return url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`;
      } catch {
        return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      }
    }
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  if (isAbsoluteUrl(trimmed)) {
    if (isLocalhostUrl(trimmed)) return null;
    // 外部 https CDN 兼容只读
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    if (!env.enableLegacyUploads) return null;
    return trimmed;
  }

  return null;
}

/**
 * API / 前端展示：objectKey → public URL；无效 legacy → null。
 */
export function getPublicImageUrl(
  value: string | null | undefined,
  env: ImageUrlEnv
): string | null {
  if (value == null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isInvalidLocalImageUrl(trimmed, env)) {
    return null;
  }

  if (isPublicOssUrl(trimmed, env.publicBaseUrl)) {
    return trimmed.replace(/\/+$/, "") === env.publicBaseUrl.replace(/\/+$/, "")
      ? null
      : trimmed;
  }

  if (isOssObjectKey(trimmed, env.objectPrefix)) {
    const base = env.publicBaseUrl.replace(/\/+$/, "");
    return `${base}/${trimmed}`;
  }

  if (isLegacyUploadPath(trimmed)) {
    if (!env.enableLegacyUploads) return null;
    const relative = trimmed.startsWith("/")
      ? trimmed
      : `/${trimmed.replace(/^uploads\//i, "/uploads/")}`;
    const base = env.publicBaseUrl.replace(/\/+$/, "");
    if (env.enableLegacyUploads && process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim()) {
      const assetBase = process.env.NEXT_PUBLIC_ASSET_BASE_URL.replace(/\/+$/, "");
      if (!isLocalhostUrl(assetBase)) {
        return `${assetBase}${relative}`;
      }
    }
    return null;
  }

  if (isAbsoluteUrl(trimmed) && !isLocalhostUrl(trimmed)) {
    return trimmed;
  }

  return null;
}

export function normalizeImageValueRequired(
  value: string | null | undefined,
  env: ImageUrlEnv
): string {
  return normalizeImageValue(value, env) ?? "";
}

export function getPublicImageUrlList(
  values: string[] | null | undefined,
  env: ImageUrlEnv
): string[] {
  if (!values?.length) return [];
  return values
    .map((v) => getPublicImageUrl(v, env))
    .filter((v): v is string => Boolean(v));
}

export function normalizeImageValueList(
  values: string[] | null | undefined,
  env: ImageUrlEnv
): string[] {
  if (!values?.length) return [];
  return values
    .map((v) => normalizeImageValue(v, env))
    .filter((v): v is string => Boolean(v));
}
