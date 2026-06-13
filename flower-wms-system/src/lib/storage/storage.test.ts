/**
 * Run: npm run test:storage
 */
import assert from "node:assert/strict";
import { buildObjectKey, parseUploadModule } from "@/lib/storage/object-key";
import { StorageError } from "@/lib/storage/errors";
import {
  getPublicImageUrl,
  isInvalidLocalImageUrl,
  isLegacyUploadPath,
  isOssObjectKey,
  isPublicOssUrl,
  normalizeImageValue,
  type ImageUrlEnv,
} from "@/lib/storage/image-url";

const ENV: ImageUrlEnv = {
  objectPrefix: "universe42",
  publicBaseUrl: "https://oss.universe42.studio",
  enableLegacyUploads: false,
  blockLocalhostImageUrl: true,
  normalizeLocalhostUploads: false,
};

const OBJECT_KEY =
  "universe42/products/spu/2026/06/550e8400-e29b-41d4-a716-446655440000.webp";

function testObjectKeyToPublicUrl() {
  const url = getPublicImageUrl(OBJECT_KEY, ENV);
  assert.equal(
    url,
    "https://oss.universe42.studio/universe42/products/spu/2026/06/550e8400-e29b-41d4-a716-446655440000.webp"
  );
}

function testNoDoubleConcat() {
  const full =
    "https://oss.universe42.studio/universe42/products/spu/2026/06/a.webp";
  assert.equal(getPublicImageUrl(full, ENV), full);
  assert.ok(isPublicOssUrl(full, ENV.publicBaseUrl));
}

function testLocalhostInvalid() {
  assert.equal(
    isInvalidLocalImageUrl("http://localhost:3000/uploads/a.jpg", ENV),
    true
  );
  assert.equal(getPublicImageUrl("http://localhost:3000/uploads/a.jpg", ENV), null);
  assert.equal(
    normalizeImageValue("http://localhost:3000/uploads/a.jpg", ENV),
    null
  );
}

function testLegacyUploadsDisabled() {
  assert.equal(isLegacyUploadPath("/uploads/a.jpg"), true);
  assert.equal(getPublicImageUrl("/uploads/a.jpg", ENV), null);
  assert.equal(normalizeImageValue("/uploads/a.jpg", ENV), null);
}

function testObjectKeySafety() {
  const key = buildObjectKey("product-spu", "webp", {
    objectPrefix: "universe42",
    now: new Date("2026-06-10T00:00:00Z"),
  });
  assert.match(key, /^universe42\/products\/spu\/2026\/06\/[0-9a-f-]+\.webp$/);
  assert.equal(key.includes(".."), false);
  assert.throws(() => buildObjectKey("product-spu", "../webp", { objectPrefix: "universe42" }), StorageError);
}

function testModuleWhitelist() {
  assert.throws(() => parseUploadModule("evil-path"), StorageError);
  assert.equal(parseUploadModule("banner"), "banner");
}

function testIsOssObjectKey() {
  assert.equal(isOssObjectKey(OBJECT_KEY, "universe42"), true);
  assert.equal(isOssObjectKey("../universe42/x.jpg", "universe42"), false);
  assert.equal(isOssObjectKey("https://evil.com/x", "universe42"), false);
}

function testNormalizeStoresObjectKeyOnly() {
  const stored = normalizeImageValue(OBJECT_KEY, ENV);
  assert.equal(stored, OBJECT_KEY);
  const fromUrl = normalizeImageValue(
    `https://oss.universe42.studio/${OBJECT_KEY}`,
    ENV
  );
  assert.equal(fromUrl, OBJECT_KEY);
}

function run() {
  testObjectKeyToPublicUrl();
  testNoDoubleConcat();
  testLocalhostInvalid();
  testLegacyUploadsDisabled();
  testObjectKeySafety();
  testModuleWhitelist();
  testIsOssObjectKey();
  testNormalizeStoresObjectKeyOnly();
  console.log("storage.test.ts: all tests passed");
}

run();
