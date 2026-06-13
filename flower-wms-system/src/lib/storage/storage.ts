import {
  getStorageConfig,
  isOssStorageConfigured,
  type StorageConfig,
} from "@/lib/storage/config";
import { StorageError } from "@/lib/storage/errors";
import { getPublicImageUrl, type ImageUrlEnv } from "@/lib/storage/image-url";
import { buildObjectKey, type UploadModule } from "@/lib/storage/object-key";
import { deleteObjectFromOss, putObjectToOss } from "@/lib/storage/oss";
import { validateImageUpload } from "@/lib/storage/upload-validation";

export type UploadImageResult = {
  objectKey: string;
  publicUrl: string;
  bucket: string;
  size: number;
  mimeType: string;
};

export function storageConfigToImageUrlEnv(
  config: StorageConfig = getStorageConfig()
): ImageUrlEnv {
  return {
    objectPrefix: config.objectPrefix,
    publicBaseUrl: config.publicBaseUrl,
    enableLegacyUploads: config.enableLegacyUploads,
    blockLocalhostImageUrl: config.blockLocalhostImageUrl,
    normalizeLocalhostUploads: config.normalizeLocalhostUploads,
  };
}

export async function uploadImageToStorage(input: {
  file: File;
  module: UploadModule;
  config?: StorageConfig;
}): Promise<UploadImageResult> {
  const config = input.config ?? getStorageConfig();

  if (!config.enableOssUpload || config.driver !== "oss") {
    throw new StorageError("STORAGE_NOT_CONFIGURED", "当前环境未启用 OSS 上传");
  }

  if (!isOssStorageConfigured(config)) {
    throw new StorageError("STORAGE_NOT_CONFIGURED", "对象存储未配置完整");
  }

  const validated = await validateImageUpload(input.file, config);
  const objectKey = buildObjectKey(input.module, validated.extension, {
    objectPrefix: config.objectPrefix,
  });

  await putObjectToOss({
    objectKey,
    buffer: validated.buffer,
    mimeType: validated.mimeType,
    config,
  });

  const env = storageConfigToImageUrlEnv(config);
  const publicUrl = getPublicImageUrl(objectKey, env);
  if (!publicUrl) {
    throw new StorageError("UPLOAD_FAILED", "无法生成图片访问地址");
  }

  return {
    objectKey,
    publicUrl,
    bucket: config.bucket,
    size: validated.size,
    mimeType: validated.mimeType,
  };
}

export async function deleteObjectFromStorage(input: {
  objectKey: string;
  config?: StorageConfig;
}): Promise<void> {
  const config = input.config ?? getStorageConfig();
  if (!isOssStorageConfigured(config)) {
    throw new StorageError("STORAGE_NOT_CONFIGURED", "对象存储未配置完整");
  }
  await deleteObjectFromOss({ objectKey: input.objectKey, config });
}

export {
  getPublicImageUrl,
  normalizeImageValue,
  isOssObjectKey,
  isPublicOssUrl,
  isInvalidLocalImageUrl,
  needsImageReupload,
  isLegacyUploadPath,
} from "@/lib/storage/image-url";

export { buildObjectKey, parseUploadModule, type UploadModule } from "@/lib/storage/object-key";
