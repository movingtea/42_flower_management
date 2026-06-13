/**
 * Run: npm run test:client-image-preview
 */
import assert from "node:assert/strict";
import {
  getClientPreviewImageUrl,
  isClientImageInvalid,
  isOssObjectKeyClient,
  isPublicOssUrlClient,
  resolveClientImagePreview,
} from "./client-image-preview";

process.env.NEXT_PUBLIC_OSS_PUBLIC_BASE_URL = "https://oss.universe42.studio";
process.env.NEXT_PUBLIC_OSS_OBJECT_PREFIX = "universe42";

const OBJECT_KEY =
  "universe42/products/sku/2026/06/550e8400-e29b-41d4-a716-446655440000.webp";

function testObjectKeyToPublicUrl() {
  const url = getClientPreviewImageUrl(OBJECT_KEY);
  assert.equal(url, `https://oss.universe42.studio/${OBJECT_KEY}`);
  assert.equal(resolveClientImagePreview(OBJECT_KEY), url);
}

function testPublicUrlPassthrough() {
  const input = `https://oss.universe42.studio/${OBJECT_KEY}`;
  assert.equal(getClientPreviewImageUrl(input), input);
}

function testNoDoublePrefix() {
  const url = getClientPreviewImageUrl(OBJECT_KEY)!;
  assert.equal(url.startsWith("https://oss.universe42.studio/https://"), false);
}

function testLocalhostInvalid() {
  assert.equal(isClientImageInvalid("http://localhost:3000/uploads/a.jpg"), true);
  assert.equal(getClientPreviewImageUrl("http://localhost:3000/uploads/a.jpg"), null);
}

function testLegacyUploadsInvalid() {
  assert.equal(isClientImageInvalid("/uploads/a.jpg"), true);
  assert.equal(getClientPreviewImageUrl("/uploads/a.jpg"), null);
}

function testEmptyNull() {
  assert.equal(getClientPreviewImageUrl(""), null);
  assert.equal(getClientPreviewImageUrl(null), null);
}

function testHelpers() {
  assert.equal(isOssObjectKeyClient(OBJECT_KEY), true);
  assert.equal(
    isPublicOssUrlClient(`https://oss.universe42.studio/${OBJECT_KEY}`),
    true
  );
}

testObjectKeyToPublicUrl();
testPublicUrlPassthrough();
testNoDoublePrefix();
testLocalhostInvalid();
testLegacyUploadsInvalid();
testEmptyNull();
testHelpers();

console.log("client-image-preview.test.ts: all passed");
