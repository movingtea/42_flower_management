import { getStorageConfig, type StorageConfig } from "@/lib/storage/config";
import { StorageError } from "@/lib/storage/errors";

export type ValidatedUploadFile = {
  buffer: Buffer;
  size: number;
  mimeType: string;
  extension: string;
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DANGEROUS_MIME_PREFIXES = [
  "text/",
  "application/javascript",
  "application/x-javascript",
  "application/pdf",
  "application/zip",
  "application/x-msdownload",
  "image/svg+xml",
];

function normalizeExtension(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\./, "");
}

function extensionFromFilename(filename: string): string | null {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  if (!match) return null;
  return normalizeExtension(match[1]);
}

export function resolveExtensionFromMime(
  mimeType: string,
  config: StorageConfig = getStorageConfig()
): string | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/svg+xml" && !config.uploadAllowSvg) {
    return null;
  }
  const mapped = MIME_TO_EXT[normalized];
  if (mapped && config.uploadAllowedExtensions.includes(mapped)) {
    return mapped;
  }
  return null;
}

export async function validateImageUpload(
  file: File,
  config: StorageConfig = getStorageConfig()
): Promise<ValidatedUploadFile> {
  if (!file || file.size === 0) {
    throw new StorageError("FILE_REQUIRED", "请选择要上传的图片");
  }

  const maxBytes = config.uploadMaxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new StorageError(
      "FILE_TOO_LARGE",
      `图片不能超过 ${config.uploadMaxSizeMb}MB`
    );
  }

  const mimeType = file.type.trim().toLowerCase();
  if (!mimeType) {
    throw new StorageError("INVALID_FILE_TYPE", "无法识别文件类型");
  }

  if (
    mimeType === "image/svg+xml" ||
    mimeType.endsWith("+xml") ||
    DANGEROUS_MIME_PREFIXES.some((p) => mimeType.startsWith(p))
  ) {
    throw new StorageError("INVALID_FILE_TYPE", "仅支持 JPG、PNG、WebP 格式");
  }

  if (!config.uploadAllowedMimeTypes.includes(mimeType)) {
    throw new StorageError("INVALID_FILE_TYPE", "仅支持 JPG、PNG、WebP 格式");
  }

  const mimeExt = resolveExtensionFromMime(mimeType, config);
  if (!mimeExt) {
    throw new StorageError("INVALID_FILE_TYPE", "仅支持 JPG、PNG、WebP 格式");
  }

  const filenameExt = extensionFromFilename(file.name);
  if (
    filenameExt &&
    !config.uploadAllowedExtensions.includes(filenameExt) &&
    filenameExt !== mimeExt
  ) {
    throw new StorageError("INVALID_FILE_TYPE", "文件扩展名与类型不匹配");
  }

  if (
    filenameExt &&
    config.uploadAllowedExtensions.includes(filenameExt) &&
    filenameExt !== mimeExt &&
    (filenameExt === "jpg" || filenameExt === "jpeg") &&
    (mimeExt === "jpg" || mimeExt === "jpeg")
  ) {
    // jpeg/jpg alias — allowed
  } else if (
    filenameExt &&
    config.uploadAllowedExtensions.includes(filenameExt) &&
    filenameExt !== mimeExt
  ) {
    throw new StorageError("INVALID_FILE_TYPE", "文件扩展名与类型不匹配");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    throw new StorageError("FILE_REQUIRED", "上传文件为空");
  }

  return {
    buffer,
    size: file.size,
    mimeType,
    extension: mimeExt,
  };
}
