import {
  getPublicImageUrl,
  normalizeImageValue,
  type ImageUrlEnv,
} from "@/lib/storage/image-url";
import { StorageError } from "@/lib/storage/errors";

/**
 * WMS-owned image upload modules. The OSS path is part of the A06 contract:
 * material, product and SKU images must live under their own WMS subtree, never
 * under the CMS product/banner paths and never under a local `/uploads` path.
 */
export const V2_UPLOAD_MODULES = [
  "wms-material",
  "wms-product",
  "wms-sku",
] as const;

export type V2UploadModule = (typeof V2_UPLOAD_MODULES)[number];

export const V2_UPLOAD_MODULE_PATHS: Readonly<Record<V2UploadModule, string>> =
  Object.freeze({
    "wms-material": "wms/materials",
    "wms-product": "wms/products",
    "wms-sku": "wms/skus",
  });

export function isV2UploadModule(value: unknown): value is V2UploadModule {
  return (
    typeof value === "string" &&
    (V2_UPLOAD_MODULES as readonly string[]).includes(value.trim())
  );
}

export function parseV2UploadModule(value: unknown): V2UploadModule {
  if (typeof value !== "string" || !value.trim()) {
    throw new StorageError("INVALID_MODULE", "缺少图片上传模块参数 module");
  }
  const uploadModule = value.trim();
  if (!isV2UploadModule(uploadModule)) {
    throw new StorageError("INVALID_MODULE", "无效的 WMS 图片上传模块");
  }
  return uploadModule;
}

/**
 * True when the stored value is a WMS object key (not a URL) under one of the
 * three A06 subtrees. The check is deliberately stricter than the generic image
 * helper so a CMS banner or recommendation key cannot be written into a WMS
 * material/product field.
 */
export function isV2ImageObjectKey(
  value: string | null | undefined,
  objectPrefix = "universe42"
): boolean {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.startsWith("/")) return false;
  if (
    trimmed.includes("..") ||
    /^https?:\/\//i.test(trimmed) ||
    /localhost|127\.0\.0\.1/i.test(trimmed)
  ) {
    return false;
  }
  const prefix = (objectPrefix || "universe42").replace(/\/+$/, "");
  if (!trimmed.startsWith(`${prefix}/`)) return false;
  const relative = trimmed.slice(prefix.length + 1);
  return Object.values(V2_UPLOAD_MODULE_PATHS).some((path) =>
    relative.startsWith(`${path}/`)
  );
}

/**
 * Normalize a WMS image reference before persisting it. Only an accepted OSS
 * objectKey survives; legacy `/uploads` paths, localhost URLs, external URLs and
 * keys from other modules all become null so a bad stored value can never be
 * rendered as a broken image by the WMS pages.
 */
export function normalizeV2ImageKey(
  value: string | null | undefined,
  env: ImageUrlEnv
): string | null {
  const normalized = normalizeImageValue(value, env);
  if (!normalized) return null;
  return isV2ImageObjectKey(normalized, env.objectPrefix) ? normalized : null;
}

/** Server-side display helper: stored objectKey -> public OSS URL. */
export function getV2ImagePreviewUrl(
  value: string | null | undefined,
  env: ImageUrlEnv
): string | null {
  const key = normalizeV2ImageKey(value, env);
  return key ? getPublicImageUrl(key, env) : null;
}
