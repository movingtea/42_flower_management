/**
 * Run: npm run test:recommendation-rules
 */
import assert from "node:assert/strict";
import {
  computeActiveSkuTotalStock,
  filterRecommendationSlotsForMiniprogram,
  hasRecommendationSellableStock,
} from "./recommendation-rules-pure";

const baseProduct = {
  id: "p1",
  name: "玫瑰礼盒",
  isActive: true,
  isDeleted: false,
  description: "浪漫花礼",
  operationNote: "内部备注",
  skus: [
    {
      id: "sku-1",
      stock: 5,
      specName: "标准款",
      price: "368",
      imageUrl: "https://cdn.example.com/a.jpg",
      isMainImage: true,
    },
  ],
};

function testActiveSlotWithStockReturns() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
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
          product: baseProduct,
        },
      ],
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[0].items[0].productName, "玫瑰礼盒");
}

function testInactiveSlotHidden() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
      name: "主推",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: false,
      sortOrder: 1,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-1",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-01",
          product: baseProduct,
        },
      ],
    },
  ]);
  assert.equal(result.length, 0);
}

function testSoldOutProductHidden() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
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
            ...baseProduct,
            skus: [{ ...baseProduct.skus[0], stock: 0 }],
          },
        },
      ],
    },
  ]);
  assert.equal(result.length, 0);
}

function testPartialStockReturns() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
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
            ...baseProduct,
            skus: [
              { ...baseProduct.skus[0], id: "sku-a", stock: 0 },
              {
                ...baseProduct.skus[0],
                id: "sku-b",
                stock: 2,
                imageUrl: "https://cdn.example.com/b.jpg",
              },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(result.length, 1);
}

function testEmptySlotNotReturned() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
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
          product: { ...baseProduct, isActive: false },
        },
      ],
    },
  ]);
  assert.equal(result.length, 0);
}

function testNoAutoFill() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
      name: "主推",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01",
      items: [],
    },
  ]);
  assert.equal(result.length, 0);
}

function testStableSort() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-b",
      key: "b",
      name: "B",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 2,
      createdAt: "2026-01-02",
      items: [
        {
          id: "item-b",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-02",
          product: baseProduct,
        },
      ],
    },
    {
      id: "slot-a",
      key: "a",
      name: "A",
      slotType: "HOME_MAIN",
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-a",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-01",
          product: baseProduct,
        },
      ],
    },
  ]);
  assert.deepEqual(
    result.map((slot) => slot.key),
    ["a", "b"]
  );
}

function testSensitiveFieldsNotInOutput() {
  const result = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-1",
      key: "home_main",
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
          note: "后台备注",
          product: baseProduct,
        },
      ],
    },
  ]);
  const item = result[0].items[0] as Record<string, unknown>;
  assert.equal("operationNote" in item, false);
  assert.equal("note" in item, false);
  assert.equal("cost" in item, false);
}

function testStockHelpers() {
  assert.equal(hasRecommendationSellableStock([{ stock: 0 }, { stock: 1 }]), true);
  assert.equal(computeActiveSkuTotalStock([{ stock: 1 }, { stock: 2 }]), 3);
}

function run() {
  testActiveSlotWithStockReturns();
  testInactiveSlotHidden();
  testSoldOutProductHidden();
  testPartialStockReturns();
  testEmptySlotNotReturned();
  testNoAutoFill();
  testStableSort();
  testSensitiveFieldsNotInOutput();
  testStockHelpers();
  console.log("recommendation-rules-pure.test.ts: all tests passed");
}

run();
