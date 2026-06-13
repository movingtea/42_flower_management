import OSS from "ali-oss";
import {
  getStorageConfig,
  isOssStorageConfigured,
  type StorageConfig,
} from "@/lib/storage/config";
import { StorageError } from "@/lib/storage/errors";

let cachedClient: OSS | null = null;
let cachedEndpoint: string | null = null;

function sanitizeOssError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;

  const message =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (message.includes("accesskey") || message.includes("secret")) {
    return new StorageError("UPLOAD_FAILED", "对象存储认证失败，请检查配置");
  }
  if (message.includes("timeout") || message.includes("econnrefused")) {
    return new StorageError("UPLOAD_FAILED", "对象存储连接失败，请稍后重试");
  }
  if (message.includes("bucket")) {
    return new StorageError("UPLOAD_FAILED", "对象存储 Bucket 不可用");
  }

  return new StorageError("UPLOAD_FAILED", "图片上传失败，请稍后重试");
}

export function createOssClient(config: StorageConfig = getStorageConfig()): OSS {
  if (!isOssStorageConfigured(config)) {
    throw new StorageError("STORAGE_NOT_CONFIGURED", "对象存储未配置");
  }

  const endpoint = config.uploadEndpoint
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (cachedClient && cachedEndpoint === endpoint) {
    return cachedClient;
  }

  cachedClient = new OSS({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    region: config.region,
    endpoint,
    secure: true,
  });
  cachedEndpoint = endpoint;

  return cachedClient;
}

export async function putObjectToOss(input: {
  objectKey: string;
  buffer: Buffer;
  mimeType: string;
  config?: StorageConfig;
}): Promise<void> {
  const config = input.config ?? getStorageConfig();
  const client = createOssClient(config);

  try {
    await client.put(input.objectKey, input.buffer, {
      headers: {
        "Content-Type": input.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    throw sanitizeOssError(err);
  }
}

export async function deleteObjectFromOss(input: {
  objectKey: string;
  config?: StorageConfig;
}): Promise<void> {
  const config = input.config ?? getStorageConfig();
  const client = createOssClient(config);

  try {
    await client.delete(input.objectKey);
  } catch (err) {
    throw sanitizeOssError(err);
  }
}

export async function headPublicObjectUrl(publicUrl: string): Promise<boolean> {
  try {
    const res = await fetch(publicUrl, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** 测试用：重置单例 client */
export function resetOssClientCacheForTests(): void {
  cachedClient = null;
  cachedEndpoint = null;
}
