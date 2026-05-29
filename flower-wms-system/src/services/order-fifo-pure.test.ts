/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/order-fifo-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  expandAndAggregateWikiDemands,
  expandWikiDemandsFromOrderItems,
  PHYSICAL_STOCK_INSUFFICIENT,
} from "./order-fifo-pure";

function testAggregateSingleSku() {
  const demands = expandAndAggregateWikiDemands([
    {
      id: "oi-1",
      quantity: 2,
      snapshotProductName: "春日花束·标准",
      recipeId: "recipe-1",
      recipeLines: [
        { flowerWikiId: "wiki-rose", quantityNeeded: 11 },
        { flowerWikiId: "wiki-euc", quantityNeeded: 3 },
      ],
    },
  ]);

  assert.equal(demands.length, 2);
  assert.deepEqual(demands.find((d) => d.flowerWikiId === "wiki-rose"), {
    flowerWikiId: "wiki-rose",
    quantity: 22,
    chineseName: undefined,
  });
  assert.deepEqual(demands.find((d) => d.flowerWikiId === "wiki-euc"), {
    flowerWikiId: "wiki-euc",
    quantity: 6,
    chineseName: undefined,
  });
}

function testAggregateMultipleSkusSameWiki() {
  const demands = expandAndAggregateWikiDemands([
    {
      id: "oi-a",
      quantity: 1,
      snapshotProductName: "A·大",
      recipeId: "r1",
      recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 5 }],
    },
    {
      id: "oi-b",
      quantity: 3,
      snapshotProductName: "B·小",
      recipeId: "r2",
      recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 2 }],
    },
  ]);

  assert.equal(demands.length, 1);
  assert.equal(demands[0].quantity, 11);
}

function testSkipSkuWithoutRecipe() {
  const demands = expandAndAggregateWikiDemands([
    {
      id: "oi-gift",
      quantity: 2,
      snapshotProductName: "周边贺卡",
      recipeId: null,
      recipeLines: [],
    },
    {
      id: "oi-flower",
      quantity: 1,
      snapshotProductName: "花束·标准",
      recipeId: "r1",
      recipeLines: [{ flowerWikiId: "wiki-rose", quantityNeeded: 10 }],
    },
  ]);

  assert.equal(demands.length, 1);
  assert.equal(demands[0].quantity, 10);
}

function testEmptyWhenAllSkusWithoutRecipe() {
  const demands = expandAndAggregateWikiDemands([
    {
      id: "oi-1",
      quantity: 1,
      snapshotProductName: "周边",
      recipeId: null,
      recipeLines: [],
    },
  ]);
  assert.equal(demands.length, 0);
}

function testLegacyExpandPerOrderItem() {
  const demands = expandWikiDemandsFromOrderItems([
    {
      id: "oi-1",
      quantity: 2,
      snapshotProductName: "春日花束",
      recipeLines: [{ flowerWikiId: "wiki-rose", quantityNeeded: 5 }],
    },
  ]);
  assert.equal(demands[0].quantity, 10);
  assert.equal(demands[0].orderItemId, "oi-1");
}

function testInvalidQuantityThrows() {
  assert.throws(
    () =>
      expandAndAggregateWikiDemands([
        {
          id: "oi-x",
          quantity: 1,
          snapshotProductName: "坏配方",
          recipeId: "r1",
          recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 0 }],
        },
      ]),
    /配方用量无效/
  );
}

function run() {
  testAggregateSingleSku();
  testAggregateMultipleSkusSameWiki();
  testSkipSkuWithoutRecipe();
  testEmptyWhenAllSkusWithoutRecipe();
  testLegacyExpandPerOrderItem();
  testInvalidQuantityThrows();
  console.log("order-fifo-pure.test.ts — 全部通过");
  console.log(`熔断文案常量: ${PHYSICAL_STOCK_INSUFFICIENT}`);
}

run();
