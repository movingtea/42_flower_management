/**
 * 图片 URL 存储与 API 输出规范化（Sprint 14：OSS objectKey + public URL）。
 * 底层实现见 src/lib/storage/image-url.ts。
 */

import {
  getPublicImageUrl as getPublicImageUrlCore,
  isAbsoluteUrl as isAbsoluteUrlCore,
  isInvalidLocalImageUrl as isInvalidLocalImageUrlCore,
  isLegacyUploadPath,
  isLocalhostUrl as isLocalhostUrlCore,
  isOssObjectKey,
  isPublicOssUrl,
  needsImageReupload,
  normalizeImageValue,
  normalizeImageValueList,
  normalizeImageValueRequired,
  getPublicImageUrlList as getPublicImageUrlListCore,
  type ImageUrlEnv,
} from "@/lib/storage/image-url";
import { getStorageConfig } from "@/lib/storage/config";
import { storageConfigToImageUrlEnv } from "@/lib/storage/storage";

export {
  isOssObjectKey,
  isPublicOssUrl,
  isLegacyUploadPath,
  needsImageReupload,
};

function imageEnv(): ImageUrlEnv {
  return storageConfigToImageUrlEnv(getStorageConfig());
}

/** 是否 http(s) 绝对 URL */
export function isAbsoluteUrl(value: string): boolean {
  return isAbsoluteUrlCore(value);
}

/** 是否包含 localhost / 127.0.0.1 */
export function isLocalhostUrl(value: string): boolean {
  return isLocalhostUrlCore(value);
}

export function isInvalidLocalImageUrl(value: string): boolean {
  return isInvalidLocalImageUrlCore(value, imageEnv());
}

/** 从 localhost / 127.0.0.1 绝对 URL 提取 pathname（legacy；新上传不应再使用） */
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
 * Sprint 14：保存 OSS objectKey；拒绝 localhost / legacy /uploads（默认）。
 */
export function normalizeStoredImagePath(
  value: string | null | undefined
): string | null {
  return normalizeImageValue(value, imageEnv());
}

/** 非空字符串字段（如 Banner.imageUrl）写入前规范化，空值返回 "" */
export function normalizeStoredImagePathRequired(
  value: string | null | undefined
): string {
  return normalizeImageValueRequired(value, imageEnv());
}

export type ToPublicImageUrlOptions = {
  /** @deprecated 使用 ALIYUN_OSS_PUBLIC_BASE_URL */
  publicBaseUrl?: string | null;
};

/**
 * API 返回或前端展示前：objectKey → https://oss.universe42.studio/...
 */
export function toPublicImageUrl(
  value: string | null | undefined,
  _options?: ToPublicImageUrlOptions
): string | null {
  const env = imageEnv();
  if (_options?.publicBaseUrl?.trim()) {
    return getPublicImageUrlCore(value, {
      ...env,
      publicBaseUrl: _options.publicBaseUrl.trim(),
    });
  }
  return getPublicImageUrlCore(value, env);
}

/** 批量规范化字符串数组（如 images[]） */
export function normalizeStoredImagePathList(
  values: string[] | null | undefined
): string[] {
  return normalizeImageValueList(values, imageEnv());
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
