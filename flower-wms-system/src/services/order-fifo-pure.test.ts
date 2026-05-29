/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/order-fifo-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  expandWikiDemandsFromOrderItems,
  PHYSICAL_STOCK_INSUFFICIENT,
} from "./order-fifo-pure";

function testExpandSingleLine() {
  const demands = expandWikiDemandsFromOrderItems([
    {
      id: "oi-1",
      quantity: 2,
      snapshotProductName: "春日花束",
      recipeLines: [
        { flowerWikiId: "wiki-rose", quantityNeeded: 11 },
        { flowerWikiId: "wiki-euc", quantityNeeded: 3 },
      ],
    },
  ]);

  assert.equal(demands.length, 2);
  assert.deepEqual(demands[0], {
    orderItemId: "oi-1",
    flowerWikiId: "wiki-rose",
    quantity: 22,
    chineseName: undefined,
  });
  assert.deepEqual(demands[1], {
    orderItemId: "oi-1",
    flowerWikiId: "wiki-euc",
    quantity: 6,
    chineseName: undefined,
  });
}

function testExpandMultipleOrderItems() {
  const demands = expandWikiDemandsFromOrderItems([
    {
      id: "oi-a",
      quantity: 1,
      snapshotProductName: "A",
      recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 5 }],
    },
    {
      id: "oi-b",
      quantity: 3,
      snapshotProductName: "B",
      recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 2 }],
    },
  ]);

  assert.equal(demands.length, 2);
  assert.equal(demands[0].quantity, 5);
  assert.equal(demands[1].quantity, 6);
  assert.equal(demands[0].flowerWikiId, demands[1].flowerWikiId);
}

function testMissingRecipeThrows() {
  assert.throws(
    () =>
      expandWikiDemandsFromOrderItems([
        {
          id: "oi-x",
          quantity: 1,
          snapshotProductName: "无配方商品",
          recipeLines: [],
        },
      ]),
    /未绑定标准配方/
  );
}

function testInvalidQuantityThrows() {
  assert.throws(
    () =>
      expandWikiDemandsFromOrderItems([
        {
          id: "oi-x",
          quantity: 1,
          snapshotProductName: "坏配方",
          recipeLines: [{ flowerWikiId: "wiki-1", quantityNeeded: 0 }],
        },
      ]),
    /配方用量无效/
  );
}

function run() {
  testExpandSingleLine();
  testExpandMultipleOrderItems();
  testMissingRecipeThrows();
  testInvalidQuantityThrows();
  console.log("order-fifo-pure.test.ts — 全部通过");
  console.log(`熔断文案常量: ${PHYSICAL_STOCK_INSUFFICIENT}`);
}

run();
