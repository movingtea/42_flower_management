import { randomUUID } from "crypto";
import { StorageError } from "@/lib/storage/errors";

/** 上传 module 白名单（前端 formData 字段） */
export const UPLOAD_MODULES = [
  "product-spu",
  "product-sku",
  "banner",
  "recommendation",
  "home-scene",
  "cms",
  "test",
] as const;

export type UploadModule = (typeof UPLOAD_MODULES)[number];

const MODULE_PATH_MAP: Record<UploadModule, string> = {
  "product-spu": "products/spu",
  "product-sku": "products/sku",
  banner: "banners",
  recommendation: "recommendations",
  "home-scene": "home-scenes",
  cms: "cms",
  test: "test",
};

export function parseUploadModule(value: unknown): UploadModule {
  if (typeof value !== "string" || !value.trim()) {
    throw new StorageError("INVALID_MODULE", "缺少上传模块参数 module");
  }
  const module = value.trim() as UploadModule;
  if (!UPLOAD_MODULES.includes(module)) {
    throw new StorageError("INVALID_MODULE", "无效的上传模块");
  }
  return module;
}

export function buildObjectKey(
  module: UploadModule,
  extension: string,
  options?: { objectPrefix?: string; now?: Date }
): string {
  const objectPrefix = (options?.objectPrefix ?? "universe42").replace(/\/+$/, "");
  const pathSegment = MODULE_PATH_MAP[module];
  if (!pathSegment) {
    throw new StorageError("INVALID_MODULE", "无效的上传模块");
  }

  const safeExt = extension.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]+$/.test(safeExt)) {
    throw new StorageError("INVALID_OBJECT_KEY", "无效的文件扩展名");
  }

  const now = options?.now ?? new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = randomUUID();

  const objectKey = `${objectPrefix}/${pathSegment}/${yyyy}/${mm}/${uuid}.${safeExt}`;

  assertSafeObjectKey(objectKey, objectPrefix);
  return objectKey;
}

export function assertSafeObjectKey(
  objectKey: string,
  objectPrefix = "universe42"
): void {
  const trimmed = objectKey.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    throw new StorageError("INVALID_OBJECT_KEY", "无效的对象路径");
  }
  if (trimmed.includes("..") || /https?:\/\//i.test(trimmed) || /localhost/i.test(trimmed)) {
    throw new StorageError("INVALID_OBJECT_KEY", "无效的对象路径");
  }
  if (!trimmed.startsWith(`${objectPrefix}/`)) {
    throw new StorageError("INVALID_OBJECT_KEY", "无效的对象路径");
  }
}
