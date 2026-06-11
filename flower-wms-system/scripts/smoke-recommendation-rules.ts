/**
 * 推荐位规则 smoke（纯函数）
 * Run: npm run smoke:recommendation-rules
 */
import assert from "node:assert/strict";
import { filterRecommendationSlotsForMiniprogram } from "../src/services/recommendation-rules-pure";

function main() {
  const empty = filterRecommendationSlotsForMiniprogram([
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
            id: "p1",
            name: "售罄",
            isActive: true,
            isDeleted: false,
            skus: [{ id: "sku-1", stock: 0, specName: "标准款", price: "199" }],
          },
        },
      ],
    },
  ]);
  assert.equal(empty.length, 0);

  const filled = filterRecommendationSlotsForMiniprogram([
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
            id: "p1",
            name: "玫瑰",
            isActive: true,
            isDeleted: false,
            skus: [
              {
                id: "sku-1",
                stock: 2,
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
  ]);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].items.length, 1);

  const inactiveIgnored = filterRecommendationSlotsForMiniprogram([
    {
      id: "slot-2",
      key: "home_secondary",
      name: "次推",
      slotType: "HOME_SECONDARY",
      sceneType: null,
      isActive: true,
      sortOrder: 1,
      createdAt: "2026-01-01",
      items: [
        {
          id: "item-2",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-01",
          product: {
            id: "p2",
            name: "停用规格有库存",
            isActive: true,
            isDeleted: false,
            skus: [
              {
                id: "sku-inactive",
                stock: 20,
                isActive: false,
                specName: "停用款",
                price: "199",
                imageUrl: "https://cdn.example.com/b.jpg",
                isMainImage: true,
              },
              {
                id: "sku-active-oos",
                stock: 0,
                isActive: true,
                specName: "可售但售罄",
                price: "199",
              },
            ],
          },
        },
      ],
    },
  ]);
  assert.equal(inactiveIgnored.length, 0, "inactive SKU stock must not count");

  console.log("smoke-recommendation-rules passed");
}

main();
