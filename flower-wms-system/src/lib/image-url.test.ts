/**
 * Run: npm run test:image-url
 */
import assert from "node:assert/strict";
import {
  isInvalidLocalImageUrl,
  isLocalhostUrl,
  normalizeStoredImagePath,
  normalizeStoredImagePathRequired,
  toPublicImageUrl,
} from "@/lib/image-url";

process.env.ENABLE_LEGACY_UPLOADS = "false";
process.env.BLOCK_LOCALHOST_IMAGE_URL = "true";
process.env.NORMALIZE_LOCALHOST_UPLOADS = "false";
process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://oss.universe42.studio";
process.env.ALIYUN_OSS_OBJECT_PREFIX = "universe42";

const OBJECT_KEY =
  "universe42/products/spu/2026/06/550e8400-e29b-41d4-a716-446655440000.webp";

function testNormalizeObjectKey() {
  assert.equal(normalizeStoredImagePath(OBJECT_KEY), OBJECT_KEY);
  assert.equal(normalizeStoredImagePathRequired(OBJECT_KEY), OBJECT_KEY);
}

function testRejectLocalhost() {
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    null
  );
  assert.equal(
    normalizeStoredImagePath("http://127.0.0.1:3000/uploads/a.jpg"),
    null
  );
  assert.equal(isInvalidLocalImageUrl("http://localhost:3000/uploads/a.jpg"), true);
}

function testRejectLegacyUploads() {
  assert.equal(normalizeStoredImagePath("/uploads/a.jpg"), null);
  assert.equal(normalizeStoredImagePath("uploads/a.jpg"), null);
}

function testExternalHttpsUnchanged() {
  const url = "https://cdn.example.com/a.jpg";
  assert.equal(normalizeStoredImagePath(url), url);
}

function testEmptyValues() {
  assert.equal(normalizeStoredImagePath(null), null);
  assert.equal(normalizeStoredImagePath(""), null);
  assert.equal(normalizeStoredImagePath("  "), null);
}

function testToPublicImageUrlObjectKey() {
  const publicUrl = toPublicImageUrl(OBJECT_KEY);
  assert.ok(publicUrl);
  assert.equal(
    publicUrl,
    `https://oss.universe42.studio/${OBJECT_KEY}`
  );
  assert.equal(isLocalhostUrl(publicUrl!), false);
}

function testToPublicImageUrlAlreadyPublic() {
  const input = `https://oss.universe42.studio/${OBJECT_KEY}`;
  assert.equal(toPublicImageUrl(input), input);
  assert.equal(toPublicImageUrl(input)?.startsWith("https://https://"), false);
}

function testLegacyPathReturnsNull() {
  assert.equal(toPublicImageUrl("/uploads/a.jpg"), null);
  assert.equal(toPublicImageUrl("http://localhost:3000/uploads/a.jpg"), null);
}

function testExtractObjectKeyFromPublicUrl() {
  const stored = normalizeStoredImagePath(
    `https://oss.universe42.studio/${OBJECT_KEY}`
  );
  assert.equal(stored, OBJECT_KEY);
}

function run() {
  testNormalizeObjectKey();
  testRejectLocalhost();
  testRejectLegacyUploads();
  testExternalHttpsUnchanged();
  testEmptyValues();
  testToPublicImageUrlObjectKey();
  testToPublicImageUrlAlreadyPublic();
  testLegacyPathReturnsNull();
  testExtractObjectKeyFromPublicUrl();
  console.log("image-url.test.ts: all tests passed");
}

run();
