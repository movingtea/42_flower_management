/**
 * CMS 首页内容 smoke（需要 DATABASE_URL）
 * Run: npm run smoke:cms-home-content
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { GiftOccasionType, RecommendationSlotType } from "../src/generated/prisma/enums";
import { prisma } from "../src/lib/prisma";
import { filterHomeBannersForMiniprogram } from "../src/services/banner-rules-pure";
import { filterRecommendationSlotsForMiniprogram } from "../src/services/recommendation-rules-pure";
import { buildFallbackMiniProgramEntries } from "../src/services/cms-home-scene-entries-pure";

const PREFIX = "SMOKE_TEST_CMS_HOME";
const NOW = new Date("2026-06-10T10:00:00.000Z");

async function main() {
  const banners = filterHomeBannersForMiniprogram(
    [
      {
        id: "inactive",
        imageUrl: "https://cdn.example.com/inactive.jpg",
        sortOrder: 1,
        isActive: false,
        targetType: "NONE",
      },
      {
        id: "soft-deleted",
        imageUrl: "https://cdn.example.com/deleted.jpg",
        sortOrder: 2,
        isActive: true,
        isDeleted: true,
        targetType: "NONE",
      },
      {
        id: "expired",
        imageUrl: "https://cdn.example.com/expired.jpg",
        sortOrder: 3,
        isActive: true,
        endsAt: new Date("2026-06-01T00:00:00.000Z"),
        targetType: "NONE",
      },
      {
        id: "not-started",
        imageUrl: "https://cdn.example.com/future.jpg",
        sortOrder: 3,
        isActive: true,
        startsAt: new Date("2026-07-01T00:00:00.000Z"),
        targetType: "NONE",
      },
      {
        id: "active",
        imageUrl: "https://cdn.example.com/active.jpg",
        sortOrder: 4,
        isActive: true,
        targetType: "NONE",
      },
    ],
    { now: NOW }
  );
  assert.deepEqual(banners.map((b) => b.id), ["active"]);

  const soldOutSlot = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: `${PREFIX}_slot`,
      name: "测试推荐位",
      slotType: RecommendationSlotType.HOME_MAIN,
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: NOW,
      items: [
        {
          id: "item-1",
          isActive: true,
          sortOrder: 1,
          createdAt: NOW,
          product: {
            id: "p1",
            name: "售罄商品",
            isActive: true,
            isDeleted: false,
            skus: [
              {
                id: "sku-1",
                stock: 0,
                specName: "标准款",
                price: "199",
                imageUrl: "https://cdn.example.com/a.jpg",
                isMainImage: true,
              },
            ],
          },
        },
      ],
    },
  ], { now: NOW });
  assert.equal(soldOutSlot.length, 0);

  const allInactiveSlot = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-inactive",
      key: `${PREFIX}_slot_inactive`,
      name: "全停用推荐位",
      slotType: RecommendationSlotType.HOME_MAIN,
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: NOW,
      items: [
        {
          id: "item-inactive",
          isActive: true,
          sortOrder: 1,
          createdAt: NOW,
          product: {
            id: "p-inactive",
            name: "全停用商品",
            isActive: true,
            isDeleted: false,
            skus: [
              {
                id: "sku-inactive",
                stock: 10,
                isActive: false,
                specName: "停用款",
                price: "199",
                imageUrl: "https://cdn.example.com/inactive.jpg",
                isMainImage: true,
              },
            ],
          },
        },
      ],
    },
  ], { now: NOW });
  assert.equal(allInactiveSlot.length, 0);

  const fallback = buildFallbackMiniProgramEntries();
  assert.ok(fallback.length >= 6, "首页场景入口 fallback 应可用");

  const spu = await prisma.productSpu.create({
    data: {
      name: `${PREFIX} 商品`,
      isActive: true,
      occasionTags: [GiftOccasionType.BIRTHDAY],
      skus: {
        create: {
          skuCode: `${PREFIX}_${Date.now()}`,
          specName: "标准款",
          price: 299,
          stock: 5,
          isMainImage: true,
          imageUrl: "https://example.com/smoke.jpg",
        },
      },
    },
    include: { skus: true },
  });

  const withStock = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-2",
      key: `${PREFIX}_slot_stock`,
      name: "有库存推荐位",
      slotType: RecommendationSlotType.HOME_MAIN,
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: NOW,
      items: [
        {
          id: "item-2",
          isActive: true,
          sortOrder: 1,
          createdAt: NOW,
          product: {
            id: spu.id,
            name: spu.name,
            isActive: true,
            isDeleted: false,
            skus: spu.skus.map((sku) => ({
              id: sku.id,
              stock: sku.stock,
              isActive: sku.isActive !== false,
              specName: sku.specName,
              price: sku.price.toString(),
              imageUrl: sku.imageUrl,
              isMainImage: sku.isMainImage,
            })),
          },
        },
      ],
    },
  ], { now: NOW });
  assert.equal(withStock.length, 1);

  console.log("smoke-cms-home-content passed");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
