/** OSS / 本地存储运行时配置（从环境变量读取） */

export type StorageDriver = "oss" | "local";

export type StorageConfig = {
  driver: StorageDriver;
  enableOssUpload: boolean;
  enableLegacyUploads: boolean;
  bucket: string;
  region: string;
  endpoint: string;
  internalEndpoint: string;
  uploadEndpoint: string;
  publicBaseUrl: string;
  objectPrefix: string;
  accessKeyId: string;
  accessKeySecret: string;
  uploadMaxSizeMb: number;
  uploadAllowedMimeTypes: string[];
  uploadAllowedExtensions: string[];
  uploadAllowSvg: boolean;
  imageStorageMode: "object_key" | "url";
  imageReturnPublicUrl: boolean;
  blockLocalhostImageUrl: boolean;
  normalizeLocalhostUploads: boolean;
};

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function getStorageConfig(): StorageConfig {
  const driver = (process.env.STORAGE_DRIVER?.trim() || "oss") as StorageDriver;

  return {
    driver,
    enableOssUpload: parseBool(process.env.ENABLE_OSS_UPLOAD, true),
    enableLegacyUploads: parseBool(process.env.ENABLE_LEGACY_UPLOADS, false),
    bucket: process.env.ALIYUN_OSS_BUCKET?.trim() || "universe42",
    region: process.env.ALIYUN_OSS_REGION?.trim() || "oss-cn-hangzhou",
    endpoint:
      process.env.ALIYUN_OSS_ENDPOINT?.trim() ||
      "https://oss-cn-hangzhou.aliyuncs.com",
    internalEndpoint:
      process.env.ALIYUN_OSS_INTERNAL_ENDPOINT?.trim() ||
      "https://oss-cn-hangzhou-internal.aliyuncs.com",
    uploadEndpoint:
      process.env.ALIYUN_OSS_UPLOAD_ENDPOINT?.trim() ||
      process.env.ALIYUN_OSS_INTERNAL_ENDPOINT?.trim() ||
      "https://oss-cn-hangzhou-internal.aliyuncs.com",
    publicBaseUrl:
      process.env.ALIYUN_OSS_PUBLIC_BASE_URL?.trim() ||
      "https://oss.universe42.studio",
    objectPrefix: process.env.ALIYUN_OSS_OBJECT_PREFIX?.trim() || "universe42",
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim() || "",
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim() || "",
    uploadMaxSizeMb: Number(process.env.UPLOAD_MAX_SIZE_MB?.trim() || "3") || 3,
    uploadAllowedMimeTypes: parseCsv(process.env.UPLOAD_ALLOWED_MIME_TYPES, [
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    uploadAllowedExtensions: parseCsv(process.env.UPLOAD_ALLOWED_EXTENSIONS, [
      "jpg",
      "jpeg",
      "png",
      "webp",
    ]),
    uploadAllowSvg: parseBool(process.env.UPLOAD_ALLOW_SVG, false),
    imageStorageMode:
      process.env.IMAGE_STORAGE_MODE?.trim() === "url" ? "url" : "object_key",
    imageReturnPublicUrl: parseBool(process.env.IMAGE_RETURN_PUBLIC_URL, true),
    blockLocalhostImageUrl: parseBool(process.env.BLOCK_LOCALHOST_IMAGE_URL, true),
    normalizeLocalhostUploads: parseBool(
      process.env.NORMALIZE_LOCALHOST_UPLOADS,
      false
    ),
  };
}

export function isOssStorageConfigured(config: StorageConfig = getStorageConfig()): boolean {
  if (!config.enableOssUpload || config.driver !== "oss") return false;
  return Boolean(
    config.bucket &&
      config.accessKeyId &&
      config.accessKeySecret &&
      config.uploadEndpoint &&
      config.publicBaseUrl
  );
}
