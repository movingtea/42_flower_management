/**
 * 纯函数单测（无数据库）— 运行：npm run test:miniprogram-stock
 */
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import {
  assertOrderStockAvailable,
  assertSellableSpu,
  computeSkuStockFlags,
  computeStockSummary,
  formatInsufficientStockMessage,
  mergeOrderLineQuantities,
  resolveDisplayStatus,
  validateCartQuantity,
} from "@/services/miniprogram-stock-pure";

function testCartAddAllowed() {
  const result = validateCartQuantity({
    stock: 5,
    existingQty: 3,
    addQty: 1,
  });
  assert.equal(result.ok, true);
}

function testCartAddBlocked() {
  const result = validateCartQuantity({
    stock: 5,
    existingQty: 3,
    addQty: 3,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK);
  }
}

function testSoldOutIsNotOffShelf() {
  const displayStatus = resolveDisplayStatus(
    { isActive: true, isDeleted: false },
    [{ stock: 0 }]
  );
  assert.equal(displayStatus, "SOLD_OUT");
}

function testInactiveProductIsOffShelf() {
  const displayStatus = resolveDisplayStatus(
    { isActive: false, isDeleted: false },
    [{ stock: 10 }]
  );
  assert.equal(displayStatus, "OFF_SHELF");
}

function testInsufficientStockError() {
  assert.throws(
    () =>
      assertOrderStockAvailable({
        specName: "标准款",
        stock: 2,
        requestedQty: 3,
      }),
    /库存不足/
  );
}

function testMergeOrderLines() {
  const merged = mergeOrderLineQuantities([
    { skuId: "sku-1", quantity: 2 },
    { skuId: "sku-1", quantity: 3 },
    { skuId: "sku-2", quantity: 1 },
  ]);
  assert.equal(merged.get("sku-1"), 5);
  assert.equal(merged.get("sku-2"), 1);
}

function testStockZeroDoesNotChangeActiveFlag() {
  const activeSpu = { isActive: true, isDeleted: false };
  assert.equal(resolveDisplayStatus(activeSpu, [{ stock: 0 }]), "SOLD_OUT");
  assert.equal(activeSpu.isActive, true);
}

function testLowStockThreshold() {
  assert.equal(computeSkuStockFlags(3).lowStock, true);
  assert.equal(computeSkuStockFlags(4).lowStock, false);
  assert.equal(computeSkuStockFlags(0).hasStock, false);
}

function testStockSummary() {
  const summary = computeStockSummary([
    { stock: 2 },
    { stock: 1 },
    { stock: 0 },
  ]);
  assert.equal(summary.totalStock, 3);
  assert.equal(summary.hasStock, true);
  assert.equal(summary.lowStock, true);
}

function testAssertSellableSpu() {
  assert.throws(
    () => assertSellableSpu({ isActive: false, isDeleted: false }),
    /商品已下架/
  );
}

function testFormatInsufficientStockMessage() {
  assert.equal(
    formatInsufficientStockMessage("大号", 2),
    "库存不足，大号 当前仅剩 2 件"
  );
}

function run() {
  testCartAddAllowed();
  testCartAddBlocked();
  testSoldOutIsNotOffShelf();
  testInactiveProductIsOffShelf();
  testInsufficientStockError();
  testMergeOrderLines();
  testStockZeroDoesNotChangeActiveFlag();
  testLowStockThreshold();
  testStockSummary();
  testAssertSellableSpu();
  testFormatInsufficientStockMessage();
  console.log("miniprogram-stock-pure.test.ts: all passed");
}

run();
