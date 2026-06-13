import assert from "node:assert/strict";
import {
  getCmsSkuEditorBadge,
  getSkuDisplayStatus,
  getSkuStatusBadgeLabel,
  skuStatusBadgeClassName,
} from "./sku-display";

function testActiveSku() {
  assert.equal(getSkuDisplayStatus({ isActive: true, stock: 5 }), "active");
  assert.equal(getSkuStatusBadgeLabel("active", "cms"), null);
  assert.equal(getSkuStatusBadgeLabel("active", "miniprogram"), null);
  assert.match(skuStatusBadgeClassName("active"), /emerald/);
}

function testCmsSoldOutLabelNotConsumerCopy() {
  assert.equal(getSkuDisplayStatus({ isActive: true, stock: 0 }), "sold_out");
  assert.equal(getSkuStatusBadgeLabel("sold_out", "cms"), "库存为 0");
  assert.notEqual(getSkuStatusBadgeLabel("sold_out", "cms"), "卖光啦！");
}

function testMiniprogramSoldOutLabelUnchanged() {
  assert.equal(getSkuStatusBadgeLabel("sold_out", "miniprogram"), "卖光啦！");
}

function testInactiveSku() {
  assert.equal(getSkuDisplayStatus({ isActive: false, stock: 10 }), "inactive");
  assert.equal(getSkuStatusBadgeLabel("inactive", "cms"), "已停用");
  assert.equal(
    getSkuStatusBadgeLabel("inactive", "miniprogram"),
    "该规格暂不可售"
  );
  assert.match(skuStatusBadgeClassName("inactive"), /zinc/);
}

function testInactiveOverridesSoldOut() {
  assert.equal(getSkuDisplayStatus({ isActive: false, stock: 0 }), "inactive");
}

function testCmsEditorNewSkuStockZero() {
  const badge = getCmsSkuEditorBadge({ isActive: true, stock: 0 });
  assert.equal(badge.label, "未保存");
  assert.equal(badge.status, "draft");
  assert.notEqual(badge.label, "卖光啦！");
}

function testCmsEditorSavedSkuStockZero() {
  const badge = getCmsSkuEditorBadge({
    id: "sku-1",
    isActive: true,
    stock: 0,
  });
  assert.equal(badge.label, "库存为 0");
  assert.equal(badge.hint, "小程序前台将显示售罄");
  assert.notEqual(badge.label, "卖光啦！");
}

function testCmsEditorInactive() {
  const badge = getCmsSkuEditorBadge({
    id: "sku-1",
    isActive: false,
    stock: 10,
  });
  assert.equal(badge.label, "已停用");
  assert.match(badge.hint ?? "", /已停用/);
}

function testCmsEditorActiveInStock() {
  const badge = getCmsSkuEditorBadge({
    id: "sku-1",
    isActive: true,
    stock: 11,
  });
  assert.equal(badge.label, "可售");
  assert.equal(badge.status, "active");
}

testActiveSku();
testCmsSoldOutLabelNotConsumerCopy();
testMiniprogramSoldOutLabelUnchanged();
testInactiveSku();
testInactiveOverridesSoldOut();
testCmsEditorNewSkuStockZero();
testCmsEditorSavedSkuStockZero();
testCmsEditorInactive();
testCmsEditorActiveInStock();

console.log("sku-display.test.ts: all passed");
