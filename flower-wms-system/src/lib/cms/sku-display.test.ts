import assert from "node:assert/strict";
import {
  getSkuDisplayStatus,
  getSkuStatusBadgeLabel,
  skuStatusBadgeClassName,
} from "./sku-display";

function testActiveSku() {
  assert.equal(getSkuDisplayStatus({ isActive: true, stock: 5 }), "active");
  assert.equal(getSkuStatusBadgeLabel("active"), null);
  assert.match(skuStatusBadgeClassName("active"), /emerald/);
}

function testSoldOutSku() {
  assert.equal(getSkuDisplayStatus({ isActive: true, stock: 0 }), "sold_out");
  assert.equal(getSkuStatusBadgeLabel("sold_out"), "卖光啦！");
  assert.match(skuStatusBadgeClassName("sold_out"), /amber/);
}

function testInactiveSku() {
  assert.equal(getSkuDisplayStatus({ isActive: false, stock: 10 }), "inactive");
  assert.equal(getSkuStatusBadgeLabel("inactive"), "已停用");
  assert.match(skuStatusBadgeClassName("inactive"), /zinc/);
}

function testInactiveOverridesSoldOut() {
  assert.equal(getSkuDisplayStatus({ isActive: false, stock: 0 }), "inactive");
}

testActiveSku();
testSoldOutSku();
testInactiveSku();
testInactiveOverridesSoldOut();

console.log("sku-display.test.ts: all passed");
