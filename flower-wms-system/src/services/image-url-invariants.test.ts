/**
 * Run: npm run test:image-url-invariants
 */
import assert from "node:assert/strict";
import {
  isInvalidLocalImageUrl,
  isLocalhostUrl,
  normalizeStoredImagePath,
  toPublicImageUrl,
} from "@/lib/image-url";

process.env.ENABLE_LEGACY_UPLOADS = "false";
process.env.BLOCK_LOCALHOST_IMAGE_URL = "true";
process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://oss.universe42.studio";
process.env.ALIYUN_OSS_OBJECT_PREFIX = "universe42";

const OBJECT_KEY = "universe42/banners/2026/06/a.webp";

function testStoreObjectKey() {
  assert.equal(normalizeStoredImagePath(OBJECT_KEY), OBJECT_KEY);
}

function testDoNotStoreLocalhost() {
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    null
  );
}

function testLegacyUploadsDisabled() {
  assert.equal(normalizeStoredImagePath("/uploads/a.jpg"), null);
  assert.equal(toPublicImageUrl("/uploads/a.jpg"), null);
}

function testPublicUrlFromObjectKey() {
  const publicUrl = toPublicImageUrl(OBJECT_KEY);
  assert.ok(publicUrl);
  assert.equal(isLocalhostUrl(publicUrl!), false);
  assert.ok(publicUrl!.includes("oss.universe42.studio"));
}

function testNoDoubleConcat() {
  const url =
    "https://oss.universe42.studio/universe42/banners/2026/06/a.webp";
  assert.equal(toPublicImageUrl(url), url);
}

function testExternalCdnReadOnly() {
  const url = "https://cdn.example.com/a.jpg";
  assert.equal(normalizeStoredImagePath(url), url);
}

function run() {
  testStoreObjectKey();
  testDoNotStoreLocalhost();
  testLegacyUploadsDisabled();
  testPublicUrlFromObjectKey();
  testNoDoubleConcat();
  testExternalCdnReadOnly();
  assert.equal(
    isInvalidLocalImageUrl("http://localhost:3000/uploads/a.jpg"),
    true
  );
  console.log("image-url-invariants.test.ts: all tests passed");
}

run();
