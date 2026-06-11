/**
 * Run: npm run test:sku-active-invariants
 */
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import { validateProductPublishReadiness } from "@/services/cms-product-validation-pure";
import { evaluateRecommendationItemDisplayStatus } from "@/services/recommendation-display-pure";
import {
  computeActiveSkuTotalStock,
  filterRecommendationSlotsForMiniprogram,
  hasRecommendationSellableStock,
} from "@/services/recommendation-rules-pure";
import {
  assertOrderStockAvailable,
  assertSellableSku,
  computeStockSummary,
  filterActiveSkus,
  resolveDisplayStatus,
} from "@/services/miniprogram-stock-pure";

const activeSpu = { isActive: true, isDeleted: false };

function testSoldOutNotInactive() {
  assert.equal(
    resolveDisplayStatus(activeSpu, [{ stock: 0, isActive: true }]),
    "SOLD_OUT"
  );
}

function testInactiveSkuNotSoldOut() {
  assert.throws(
    () => assertSellableSku({ isActive: false }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, MINIPROGRAM_ERROR_CODES.SKU_INACTIVE);
      return true;
    }
  );
}

function testInactiveStockNotCounted() {
  assert.equal(
    computeStockSummary([
      { stock: 10, isActive: false },
      { stock: 0, isActive: true },
    ]).totalStock,
    0
  );
  assert.equal(
    computeActiveSkuTotalStock([
      { stock: 10, isActive: false },
      { stock: 2, isActive: true },
    ]),
    2
  );
}

function testAllSkuInactiveHidden() {
  assert.equal(
    resolveDisplayStatus(activeSpu, [
      { stock: 10, isActive: false },
      { stock: 5, isActive: false },
    ]),
    "OFF_SHELF"
  );
  assert.equal(filterActiveSkus([{ stock: 1, isActive: false }]).length, 0);
}

function testRecommendationInactiveStockIgnored() {
  assert.equal(
    hasRecommendationSellableStock([
      { stock: 99, isActive: false },
      { stock: 0, isActive: true },
    ]),
    false
  );
  const slots = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home",
      name: "首页",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 0,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-1",
          isActive: true,
          sortOrder: 0,
          createdAt: "2026-01-01",
          product: {
            id: "p1",
            name: "测试",
            isActive: true,
            isDeleted: false,
            skus: [
              { id: "s1", stock: 10, isActive: false, specName: "A", price: "1" },
              { id: "s2", stock: 0, isActive: true, specName: "B", price: "1", imageUrl: "https://cdn.example.com/a.jpg", isMainImage: true },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(slots.length, 0);
}

function testRecommendationActiveStockVisible() {
  const slots = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home",
      name: "首页",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 0,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-1",
          isActive: true,
          sortOrder: 0,
          createdAt: "2026-01-01",
          product: {
            id: "p1",
            name: "测试",
            isActive: true,
            isDeleted: false,
            skus: [
              { id: "s1", stock: 2, isActive: true, specName: "A", price: "1", imageUrl: "https://cdn.example.com/a.jpg", isMainImage: true },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0]!.items.length, 1);
}

function testRecommendationDisplayAllInactive() {
  const result = evaluateRecommendationItemDisplayStatus({
    isActive: true,
    product: {
      isActive: true,
      skus: [{ stock: 10, isActive: false }],
    },
  });
  assert.equal(result.status, "ALL_SKUS_INACTIVE");
  assert.equal(result.visibleOnMiniprogram, false);
}

function testPublishReadinessAllInactive() {
  const result = validateProductPublishReadiness({
    product: {
      id: "p1",
      name: "测试",
      mainImage: "https://cdn.example.com/a.jpg",
    },
    skus: [
      { id: "s1", name: "A", price: 100, isActive: false, stock: 5 },
    ],
  });
  assert.ok(
    result.blockingIssues.some((i) => i.code === "NO_ENABLED_SKU"),
    "all inactive should block publish"
  );
}

function testOrderInactiveBeforeStock() {
  assert.throws(
    () =>
      assertOrderStockAvailable({
        specName: "标准款",
        stock: 10,
        requestedQty: 1,
        isActive: false,
      }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, MINIPROGRAM_ERROR_CODES.SKU_INACTIVE);
      return true;
    }
  );
}

function run() {
  testSoldOutNotInactive();
  testInactiveSkuNotSoldOut();
  testInactiveStockNotCounted();
  testAllSkuInactiveHidden();
  testRecommendationInactiveStockIgnored();
  testRecommendationActiveStockVisible();
  testRecommendationDisplayAllInactive();
  testPublishReadinessAllInactive();
  testOrderInactiveBeforeStock();
  console.log("sku-active-invariants.test.ts: all tests passed");
}

run();
