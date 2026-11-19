import assert from "node:assert/strict";
import { StorageError } from "@/lib/storage/errors";
import type { ImageUrlEnv } from "@/lib/storage/image-url";
import { buildObjectKey } from "@/lib/storage/object-key";
import {
  V2_UPLOAD_MODULE_PATHS,
  V2_UPLOAD_MODULES,
  getV2ImagePreviewUrl,
  isV2ImageObjectKey,
  parseV2UploadModule,
  normalizeV2ImageKey,
} from "./media";

const ENV: ImageUrlEnv = {
  objectPrefix: "universe42",
  publicBaseUrl: "https://oss.universe42.studio",
  enableLegacyUploads: false,
  blockLocalhostImageUrl: true,
  normalizeLocalhostUploads: false,
};

const MATERIAL_KEY = "universe42/wms/materials/2026/11/550e8400-e29b-41d4-a716-446655440000.webp";
const PRODUCT_KEY = "universe42/wms/products/2026/11/550e8400-e29b-41d4-a716-446655440001.png";
const SKU_KEY = "universe42/wms/skus/2026/11/550e8400-e29b-41d4-a716-446655440002.jpg";

function testUploadModulesHaveWmsPaths() {
  assert.equal(V2_UPLOAD_MODULES.length, 3);
  for (const uploadModule of V2_UPLOAD_MODULES) {
    assert.match(V2_UPLOAD_MODULE_PATHS[uploadModule], /^wms\/[a-z]+$/);
  }
  assert.equal(parseV2UploadModule(" wms-material "), "wms-material");
  assert.equal(parseV2UploadModule("wms-product"), "wms-product");
  assert.throws(() => parseV2UploadModule("cms"), StorageError);
  assert.throws(() => parseV2UploadModule("../wms-material"), StorageError);
  assert.throws(() => parseV2UploadModule(""), StorageError);

  // The storage builder and the media validator must agree on every path.
  for (const uploadModule of V2_UPLOAD_MODULES) {
    const key = buildObjectKey(uploadModule, "webp", {
      objectPrefix: "universe42",
      now: new Date("2026-11-19T00:00:00Z"),
    });
    assert.equal(
      isV2ImageObjectKey(key),
      true,
      `${uploadModule} generated a key the media validator rejects: ${key}`,
    );
    assert.match(key, /^universe42\/wms\/[a-z]+\/2026\/11\/[0-9a-f-]+\.webp$/);
  }
}

function testAcceptsOnlyWmsObjectKeys() {
  assert.equal(isV2ImageObjectKey(MATERIAL_KEY), true);
  assert.equal(isV2ImageObjectKey(PRODUCT_KEY), true);
  assert.equal(isV2ImageObjectKey(SKU_KEY), true);

  // Other OSS modules are valid images, but not valid WMS media references.
  assert.equal(
    isV2ImageObjectKey("universe42/products/spu/2026/11/a.webp"),
    false,
  );
  assert.equal(isV2ImageObjectKey("universe42/banners/2026/11/a.webp"), false);
  assert.equal(isV2ImageObjectKey("universe42/wms/unknown/2026/11/a.webp"), false);

  assert.equal(isV2ImageObjectKey("https://oss.universe42.studio/universe42/wms/materials/a.webp"), false);
  assert.equal(isV2ImageObjectKey("/uploads/a.jpg"), false);
  assert.equal(isV2ImageObjectKey("http://localhost:3000/uploads/a.jpg"), false);
  assert.equal(isV2ImageObjectKey("universe42/wms/materials/../a.webp"), false);
  assert.equal(isV2ImageObjectKey("another-prefix/wms/materials/a.webp"), false);
  assert.equal(isV2ImageObjectKey(""), false);
  assert.equal(isV2ImageObjectKey(null), false);
}

function testNormalizesStoredValueToObjectKey() {
  assert.equal(normalizeV2ImageKey(MATERIAL_KEY, ENV), MATERIAL_KEY);
  assert.equal(
    normalizeV2ImageKey(`${ENV.publicBaseUrl}/${PRODUCT_KEY}`, ENV),
    PRODUCT_KEY,
  );
  assert.equal(
    normalizeV2ImageKey(`  ${ENV.publicBaseUrl}/${SKU_KEY}  `, ENV),
    SKU_KEY,
  );

  assert.equal(normalizeV2ImageKey("", ENV), null);
  assert.equal(normalizeV2ImageKey(null, ENV), null);
  assert.equal(normalizeV2ImageKey("/uploads/a.jpg", ENV), null);
  assert.equal(normalizeV2ImageKey("http://localhost:3000/uploads/a.jpg", ENV), null);
  assert.equal(normalizeV2ImageKey("https://cdn.example.com/a.webp", ENV), null);
  assert.equal(
    normalizeV2ImageKey("universe42/products/spu/2026/11/a.webp", ENV),
    null,
  );
  assert.equal(normalizeV2ImageKey("universe42/wms/materials/../a.webp", ENV), null);
}

function testBuildsPublicPreviewUrl() {
  assert.equal(
    getV2ImagePreviewUrl(MATERIAL_KEY, ENV),
    `${ENV.publicBaseUrl}/${MATERIAL_KEY}`,
  );
  assert.equal(
    getV2ImagePreviewUrl(`${ENV.publicBaseUrl}/${PRODUCT_KEY}`, ENV),
    `${ENV.publicBaseUrl}/${PRODUCT_KEY}`,
  );
  assert.equal(getV2ImagePreviewUrl("/uploads/a.jpg", ENV), null);
  assert.equal(getV2ImagePreviewUrl("universe42/banners/a.webp", ENV), null);
  assert.equal(getV2ImagePreviewUrl(null, ENV), null);
}

testUploadModulesHaveWmsPaths();
testAcceptsOnlyWmsObjectKeys();
testNormalizesStoredValueToObjectKey();
testBuildsPublicPreviewUrl();

console.log("v2 media domain tests passed");
