/**
 * OSS 连通性测试：上传 test 模块图片并可选 HEAD 公网 URL。
 * Run: npm run test:oss
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { getStorageConfig, isOssStorageConfigured } from "../src/lib/storage/config";
import { buildObjectKey } from "../src/lib/storage/object-key";
import { headPublicObjectUrl, putObjectToOss, deleteObjectFromOss } from "../src/lib/storage/oss";
import { getPublicImageUrl } from "../src/lib/storage/image-url";
import { storageConfigToImageUrlEnv } from "../src/lib/storage/storage";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function requireEnv(label: string, value: string | undefined): string {
  if (!value?.trim()) {
    console.error(`缺少环境变量: ${label}`);
    process.exit(1);
  }
  return value.trim();
}

async function main() {
  const config = getStorageConfig();
  requireEnv("ALIYUN_OSS_BUCKET", config.bucket);
  requireEnv("ALIYUN_OSS_ACCESS_KEY_ID", config.accessKeyId);
  requireEnv("ALIYUN_OSS_ACCESS_KEY_SECRET", config.accessKeySecret);
  requireEnv("ALIYUN_OSS_UPLOAD_ENDPOINT", config.uploadEndpoint);
  requireEnv("ALIYUN_OSS_PUBLIC_BASE_URL", config.publicBaseUrl);

  if (!isOssStorageConfigured(config)) {
    console.error("OSS 未完整配置，请检查 STORAGE_DRIVER / ENABLE_OSS_UPLOAD");
    process.exit(1);
  }

  const objectKey = buildObjectKey("test", "png", {
    objectPrefix: config.objectPrefix,
  });

  console.log("Upload endpoint:", config.uploadEndpoint.replace(/\/+$/, ""));
  console.log("Uploading to objectKey:", objectKey);

  await putObjectToOss({
    objectKey,
    buffer: MINIMAL_PNG,
    mimeType: "image/png",
    config,
  });

  const env = storageConfigToImageUrlEnv(config);
  const publicUrl = getPublicImageUrl(objectKey, env);
  assert.ok(publicUrl);
  console.log("publicUrl:", publicUrl);

  const reachable = await headPublicObjectUrl(publicUrl!);
  console.log("publicUrl reachable (HEAD):", reachable);

  const keep = process.argv.includes("--keep");
  if (keep) {
    console.log("保留测试对象 (--keep):", objectKey);
  } else {
    await deleteObjectFromOss({ objectKey, config });
    console.log("已删除测试对象");
  }

  console.log("test-oss-upload: OK");
}

main().catch((err) => {
  console.error("test-oss-upload failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
