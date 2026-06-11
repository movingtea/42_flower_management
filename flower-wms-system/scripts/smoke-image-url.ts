/**
 * 图片 URL smoke（纯函数 + 可选 DB）
 * Run: npm run smoke:image-url
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { isLocalhostUrl, normalizeStoredImagePath, toPublicImageUrl } from "../src/lib/image-url";
import { filterHomeBannersForMiniprogram } from "../src/services/banner-rules-pure";
import { filterRecommendationSlotsForMiniprogram } from "../src/services/recommendation-rules-pure";

function testPureImageRules() {
  assert.equal(
    normalizeStoredImagePath("http://localhost:3000/uploads/a.jpg"),
    "/uploads/a.jpg"
  );
  const https = "https://cdn.example.com/a.jpg";
  assert.equal(normalizeStoredImagePath(https), https);

  const publicPath = toPublicImageUrl("/uploads/a.jpg");
  assert.ok(publicPath);
  assert.equal(isLocalhostUrl(publicPath!), false);
}

function testBannerNoLocalhost() {
  const banners = filterHomeBannersForMiniprogram([
    {
      id: "b1",
      imageUrl: "http://localhost:3000/uploads/banner.jpg",
      sortOrder: 1,
      isActive: true,
      targetType: "NONE",
    },
    {
      id: "b2",
      imageUrl: "https://cdn.example.com/banner.jpg",
      sortOrder: 2,
      isActive: true,
      targetType: "NONE",
    },
  ]);
  assert.equal(banners.length, 2);
  for (const banner of banners) {
    assert.equal(isLocalhostUrl(banner.imageUrl), false);
  }
}

function testRecommendationNoLocalhost() {
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
                imageUrl: "http://localhost:3000/uploads/p.jpg",
                isMainImage: true,
              },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(slots.length, 1);
  const cover = slots[0].items[0].coverImage;
  assert.equal(isLocalhostUrl(cover), false);
  assert.ok(cover.includes("/uploads/"));
}

async function main() {
  testPureImageRules();
  testBannerNoLocalhost();
  testRecommendationNoLocalhost();
  console.log("smoke-image-url passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
