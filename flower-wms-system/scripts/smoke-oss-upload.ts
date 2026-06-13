/**
 * OSS 上传 smoke（需要 OSS 凭证；无凭证时仅跑纯函数）
 * Run: npm run smoke:oss-upload
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { isOssStorageConfigured, getStorageConfig } from "../src/lib/storage/config";
import { getPublicImageUrl, isInvalidLocalImageUrl } from "../src/lib/storage/image-url";
import { storageConfigToImageUrlEnv } from "../src/lib/storage/storage";

function testPureRules() {
  const env = storageConfigToImageUrlEnv({
    ...getStorageConfig(),
    enableLegacyUploads: false,
    blockLocalhostImageUrl: true,
    publicBaseUrl: "https://oss.universe42.studio",
    objectPrefix: "universe42",
  });

  const key = "universe42/banners/2026/06/test.webp";
  const url = getPublicImageUrl(key, env);
  assert.ok(url?.includes("oss.universe42.studio"));
  assert.equal(isInvalidLocalImageUrl("http://localhost:3000/uploads/a.jpg", env), true);
  assert.equal(getPublicImageUrl("/uploads/a.jpg", env), null);
}

async function testLiveUpload() {
  if (!isOssStorageConfigured()) {
    console.log("skip live OSS upload: credentials not configured");
    return;
  }
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/test-oss-upload.ts", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

async function main() {
  testPureRules();
  await testLiveUpload();
  console.log("smoke:oss-upload passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
