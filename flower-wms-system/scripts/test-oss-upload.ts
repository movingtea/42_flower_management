/**
 * OSS 连通性测试：上传 test 模块图片并可选 HEAD 公网 URL。
 * Run: npm run test:oss
 *
 * SDK 上传使用 ALIYUN_OSS_UPLOAD_ENDPOINT（config.uploadEndpoint）。
 * ALIYUN_OSS_PUBLIC_BASE_URL 仅用于生成 publicUrl 与 HEAD 访问测试，不参与 SDK 连接。
 */
import "dotenv/config";
import assert from "node:assert/strict";
import {
  getStorageConfig,
  isOssStorageConfigured,
  type StorageConfig,
} from "../src/lib/storage/config";
import { buildObjectKey } from "../src/lib/storage/object-key";
import {
  createOssClient,
  headPublicObjectUrl,
} from "../src/lib/storage/oss";
import { getPublicImageUrl } from "../src/lib/storage/image-url";
import { storageConfigToImageUrlEnv } from "../src/lib/storage/storage";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** 必需显式配置的环境变量（bucket/region 等有默认值，单独标注） */
const REQUIRED_ENV_KEYS = [
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
] as const;

const RECOMMENDED_ENV_KEYS = [
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_UPLOAD_ENDPOINT",
  "ALIYUN_OSS_PUBLIC_BASE_URL",
  "ALIYUN_OSS_OBJECT_PREFIX",
] as const;

function maskAccessKeyId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "(未配置)";
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

function isEnvSet(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function collectMissingEnvKeys(): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    if (!isEnvSet(key)) missing.push(key);
  }
  return missing;
}

function collectRecommendedMissing(): string[] {
  const missing: string[] = [];
  for (const key of RECOMMENDED_ENV_KEYS) {
    if (!isEnvSet(key)) missing.push(key);
  }
  return missing;
}

function sdkEndpointHost(config: StorageConfig): string {
  return config.uploadEndpoint
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function printConfigDiagnostics(config: StorageConfig): void {
  const missingRequired = collectMissingEnvKeys();
  const missingRecommended = collectRecommendedMissing();
  const configured = isOssStorageConfigured(config);

  console.log("=== OSS 配置检查 ===");
  console.log(`STORAGE_DRIVER: ${config.driver}`);
  console.log(`ENABLE_OSS_UPLOAD: ${config.enableOssUpload}`);
  console.log(`bucket: ${config.bucket}`);
  console.log(`region: ${config.region}`);
  console.log(
    `uploadEndpoint (SDK 上传, ALIYUN_OSS_UPLOAD_ENDPOINT): ${config.uploadEndpoint}`
  );
  console.log(
    `publicBaseUrl (仅访问测试, ALIYUN_OSS_PUBLIC_BASE_URL): ${config.publicBaseUrl}`
  );
  console.log(`objectPrefix: ${config.objectPrefix}`);
  console.log(`accessKeyId: ${maskAccessKeyId(config.accessKeyId)}`);
  console.log(
    `accessKeySecret: ${config.accessKeySecret ? "[已配置，不显示]" : "[未配置]"}`
  );
  console.log(`SDK endpoint host: ${sdkEndpointHost(config)}`);
  console.log(
    `endpoint 外网 (ALIYUN_OSS_ENDPOINT, 非 SDK 上传): ${config.endpoint}`
  );
  console.log(
    `endpoint 内网 (ALIYUN_OSS_INTERNAL_ENDPOINT): ${config.internalEndpoint}`
  );

  if (config.uploadEndpoint === config.publicBaseUrl) {
    console.warn(
      "⚠ uploadEndpoint 与 publicBaseUrl 相同；请确认 SDK 未误用自定义域名作为上传 Endpoint"
    );
  } else {
    console.log(
      "✓ SDK 上传 Endpoint 与 publicBaseUrl 分离（uploadEndpoint ≠ publicBaseUrl）"
    );
  }

  if (!process.env.ALIYUN_OSS_UPLOAD_ENDPOINT?.trim()) {
    console.warn(
      "⚠ ALIYUN_OSS_UPLOAD_ENDPOINT 未显式设置，当前使用回退值:",
      config.uploadEndpoint
    );
  }

  if (missingRequired.length > 0) {
    console.error("缺少必需环境变量:", missingRequired.join(", "));
  } else {
    console.log("必需环境变量: 已全部配置");
  }

  if (missingRecommended.length > 0) {
    console.warn(
      "以下推荐环境变量未显式设置（将使用默认值或回退）:",
      missingRecommended.join(", ")
    );
  }

  console.log(`配置完整 (isOssStorageConfigured): ${configured ? "是" : "否"}`);
  console.log("===================\n");
}

type AliOssErrorShape = {
  name?: string;
  code?: string | number;
  status?: string | number;
  message?: string;
  requestId?: string;
  hostId?: string;
  ecCode?: string;
  [key: string]: unknown;
};

function formatAliOssError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") {
    return { raw: String(err) };
  }

  const e = err as AliOssErrorShape;
  const out: Record<string, unknown> = {
    name: e.name ?? null,
    code: e.code ?? null,
    status: e.status ?? null,
    message: e.message ?? (err instanceof Error ? err.message : null),
    requestId: e.requestId ?? null,
  };

  if (e.hostId) out.hostId = e.hostId;
  if (e.ecCode) out.ecCode = e.ecCode;

  return out;
}

function printAliOssError(phase: string, err: unknown): void {
  const details = formatAliOssError(err);
  console.error(`\n[${phase}] ali-oss 错误详情:`);
  for (const [key, value] of Object.entries(details)) {
    if (value != null && value !== "") {
      console.error(`  ${key}: ${value}`);
    }
  }
  console.error("\n完整错误对象 (JSON):");
  console.error(JSON.stringify(details, null, 2));
}

async function putTestObject(
  config: StorageConfig,
  objectKey: string
): Promise<void> {
  const client = createOssClient(config);
  const sdkHost = sdkEndpointHost(config);

  console.log("--- SDK 上传 ---");
  console.log(`使用 uploadEndpoint: ${config.uploadEndpoint}`);
  console.log(`SDK 连接 host: ${sdkHost}`);
  console.log(`未使用 publicBaseUrl 作为 SDK Endpoint: ${config.publicBaseUrl}`);
  console.log(`objectKey: ${objectKey}`);

  try {
    await client.put(objectKey, MINIMAL_PNG, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    console.log("SDK 上传: 成功\n");
  } catch (err) {
    printAliOssError("SDK put", err);
    throw err;
  }
}

async function main() {
  const config = getStorageConfig();
  printConfigDiagnostics(config);

  const missingRequired = collectMissingEnvKeys();
  if (missingRequired.length > 0) {
    console.error("test-oss-upload 中止：请先配置上述缺失项");
    process.exit(1);
  }

  if (!isOssStorageConfigured(config)) {
    console.error(
      "test-oss-upload 中止：OSS 未完整配置（检查 STORAGE_DRIVER=oss、ENABLE_OSS_UPLOAD=true）"
    );
    process.exit(1);
  }

  const objectKey = buildObjectKey("test", "png", {
    objectPrefix: config.objectPrefix,
  });

  await putTestObject(config, objectKey);

  const env = storageConfigToImageUrlEnv(config);
  const publicUrl = getPublicImageUrl(objectKey, env);
  assert.ok(publicUrl);

  console.log("--- 公网访问测试（非 SDK 上传）---");
  console.log(`publicUrl: ${publicUrl}`);
  console.log(`来源: ALIYUN_OSS_PUBLIC_BASE_URL + objectKey`);

  const reachable = await headPublicObjectUrl(publicUrl!);
  console.log(`publicUrl reachable (HEAD): ${reachable}`);
  if (!reachable) {
    console.warn(
      "⚠ HEAD 公网 URL 失败：可能是 CDN/自定义域名未绑定、对象 ACL 或网络问题；SDK 上传已成功时可单独排查"
    );
  }

  const keep = process.argv.includes("--keep");
  if (keep) {
    console.log("保留测试对象 (--keep):", objectKey);
  } else {
    try {
      const client = createOssClient(config);
      await client.delete(objectKey);
      console.log("已删除测试对象");
    } catch (err) {
      printAliOssError("SDK delete", err);
      throw err;
    }
  }

  console.log("\ntest-oss-upload: OK");
}

main().catch((err) => {
  if (err && typeof err === "object" && "code" in err) {
    // 已在 putTestObject / delete 中打印过 ali-oss 详情
    process.exit(1);
  }
  console.error("test-oss-upload failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
