/**
 * 图片 URL smoke（Sprint 14 OSS objectKey）
 * Run: npm run smoke:image-url
 */
import "dotenv/config";
import assert from "node:assert/strict";
import {
  isInvalidLocalImageUrl,
  isLocalhostUrl,
  normalizeStoredImagePath,
  toPublicImageUrl,
} from "../src/lib/image-url";
import { filterHomeBannersForMiniprogram } from "../src/services/banner-rules-pure";
import { filterRecommendationSlotsForMiniprogram } from "../src/services/recommendation-rules-pure";

process.env.ENABLE_LEGACY_UPLOADS = "false";
process.env.BLOCK_LOCALHOST_IMAGE_URL = "true";
process.env.ALIYUN_OSS_PUBLIC_BASE_URL =
  process.env.ALIYUN_OSS_PUBLIC_BASE_URL || "https://oss.universe42.studio";
process.env.ALIYUN_OSS_OBJECT_PREFIX =
  process.env.ALIYUN_OSS_OBJECT_PREFIX || "universe42";

const OBJECT_KEY =
  "universe42/products/sku/2026/06/550e8400-e29b-41d4-a716-446655440000.webp";

function testObjectKeyPublicUrl() {
  const url = toPublicImageUrl(OBJECT_KEY);
  assert.ok(url);
  assert.ok(url!.includes("oss.universe42.studio"));
  assert.equal(isLocalhostUrl(url!), false);
}

function testLegacyAndLocalhostInvalid() {
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    null
  );
  assert.equal(normalizeStoredImagePath("/uploads/a.jpg"), null);
  assert.equal(toPublicImageUrl("/uploads/a.jpg"), null);
  assert.equal(isInvalidLocalImageUrl("http://localhost:3000/uploads/a.jpg"), true);
}

function testBannerOssImage() {
  const banners = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: OBJECT_KEY,
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
    },
    {
      id: "b2",
      imageUrl: "http://localhost:3000/uploads/banner.jpg",
      sortOrder: 2,
      isActive: true,
      targetType: "NONE",
    },
  ]);
  assert.equal(banners.length, 1);
  assert.equal(banners[0].id, "b1");
  assert.ok(banners[0].imageUrl.includes("oss.universe42.studio"));
}

function testRecommendationOssCover() {
  const slots = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home",
      name: "主推",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-1",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-01",
          product: {
            id: "p1",
            name: "测试",
            isActive: true,
            isDeleted: false,
            skus: [
              {
                id: "sku-1",
                stock: 3,
                specName: "标准款",
                price: "199",
                imageUrl: OBJECT_KEY,
                isMainImage: true,
                isActive: true,
              },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(slots.length, 1);
  const cover = slots[0].items[0].coverImage;
  assert.ok(cover?.includes("oss.universe42.studio"));
  assert.equal(isLocalhostUrl(cover!), false);
}

async function main() {
  testObjectKeyPublicUrl();
  testLegacyAndLocalhostInvalid();
  testBannerOssImage();
  testRecommendationOssCover();
  console.log("smoke-image-url passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
