/**
 * Run with:
 *   npx tsx src/lib/purchase-line-form-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  createDefaultPurchaseLine,
  DEFAULT_FLOWER_USABLE_RATE_PERCENT,
  DEFAULT_PURCHASE_LINE_ITEM_TYPE,
  getPurchaseLineRequiredFields,
  getPurchaseLineVisibleFields,
  inferPurchaseLineItemTypeFromSavedLine,
  insertNewPurchaseLineAtTop,
  isFlowerPurchaseLineItemType,
  isPurchaseLineFieldVisible,
  isPurchaseLineReadyForPreview,
  validatePurchaseLineDraft,
} from "@/lib/purchase-line-form-pure";

function testDefaultFlowerLine() {
  const line = createDefaultPurchaseLine();
  assert.equal(line.itemType, "FLOWER");
  assert.equal(line.usableRate, DEFAULT_FLOWER_USABLE_RATE_PERCENT);
  assert.equal(line.stemsPerUnit, "10");
}

function testDefaultNonFlowerLine() {
  const line = createDefaultPurchaseLine("PACKAGING");
  assert.equal(line.itemType, "PACKAGING");
  assert.equal(line.usableRate, "");
  assert.equal(line.stemsPerUnit, "1");
  assert.equal(line.purchaseUnit, "件");
}

function testFlowerVisibleFields() {
  const fields = getPurchaseLineVisibleFields("FLOWER");
  assert.ok(fields.includes("usableRate"));
  assert.ok(fields.includes("stemsPerUnit"));
  assert.ok(!fields.includes("spec"));
  assert.ok(!fields.includes("materialName"));
}

function testPackagingVisibleFields() {
  const fields = getPurchaseLineVisibleFields("PACKAGING");
  assert.ok(fields.includes("spec"));
  assert.ok(fields.includes("materialName"));
  assert.ok(!fields.includes("usableRate"));
  assert.ok(!fields.includes("stemsPerUnit"));
  assert.ok(!fields.includes("grade"));
  assert.ok(!fields.includes("flowerSelect"));
}

function testRequiredFieldsByType() {
  assert.deepEqual(getPurchaseLineRequiredFields("FLOWER"), [
    "itemType",
    "flowerSelect",
    "purchaseName",
    "purchaseQuantity",
    "purchaseUnit",
    "stemsPerUnit",
    "unitPrice",
    "usableRate",
  ]);
  assert.deepEqual(getPurchaseLineRequiredFields("SUPPLY"), [
    "itemType",
    "materialName",
    "purchaseQuantity",
    "purchaseUnit",
    "unitPrice",
  ]);
}

function testInsertAtTop() {
  const existing = [{ id: "a" }, { id: "b" }];
  const next = insertNewPurchaseLineAtTop(existing, { id: "new" });
  assert.deepEqual(next.map((line) => line.id), ["new", "a", "b"]);
}

function testFieldVisibilityHelpers() {
  assert.equal(isPurchaseLineFieldVisible("FLOWER", "usableRate"), true);
  assert.equal(isPurchaseLineFieldVisible("FLOWER", "spec"), false);
  assert.equal(isPurchaseLineFieldVisible("TOOL", "spec"), true);
  assert.equal(isPurchaseLineFieldVisible("TOOL", "usableRate"), false);
}

function testValidateFlowerLine() {
  const line = createDefaultPurchaseLine();
  assert.equal(
    validatePurchaseLineDraft(line, "第 1 行："),
    "第 1 行：请选择花材"
  );
  line.flowerWikiId = "fw-1";
  line.purchaseName = "红玫瑰";
  assert.equal(validatePurchaseLineDraft(line, "第 1 行："), null);
}

function testValidateNonFlowerLine() {
  const line = createDefaultPurchaseLine("SUPPLY");
  assert.equal(
    validatePurchaseLineDraft(line, "第 1 行："),
    "第 1 行：物料名称不能为空"
  );
  line.purchaseName = "花艺铁丝";
  assert.equal(validatePurchaseLineDraft(line, "第 1 行："), null);
}

function testPreviewReadiness() {
  const flower = createDefaultPurchaseLine();
  assert.equal(isPurchaseLineReadyForPreview(flower), false);
  flower.flowerWikiId = "fw-1";
  flower.purchaseName = "红玫瑰";
  assert.equal(isPurchaseLineReadyForPreview(flower), true);

  const supply = createDefaultPurchaseLine("SUPPLY");
  supply.purchaseName = "包装纸";
  assert.equal(isPurchaseLineReadyForPreview(supply), true);
}

function testInferItemTypeFromSavedLine() {
  assert.equal(
    inferPurchaseLineItemTypeFromSavedLine({
      flowerWikiId: "fw-1",
      grade: "A",
      spec: "20cm",
    }),
    "FLOWER"
  );
  assert.equal(
    inferPurchaseLineItemTypeFromSavedLine({
      flowerWikiId: "fw-1",
      spec: "50cm 包装纸",
    }),
    "OTHER"
  );
  assert.equal(
    inferPurchaseLineItemTypeFromSavedLine({}),
    DEFAULT_PURCHASE_LINE_ITEM_TYPE
  );
}

function testIsFlowerItemType() {
  assert.equal(isFlowerPurchaseLineItemType("FLOWER"), true);
  assert.equal(isFlowerPurchaseLineItemType("PACKAGING"), false);
}

function run() {
  testDefaultFlowerLine();
  testDefaultNonFlowerLine();
  testFlowerVisibleFields();
  testPackagingVisibleFields();
  testRequiredFieldsByType();
  testInsertAtTop();
  testFieldVisibilityHelpers();
  testValidateFlowerLine();
  testValidateNonFlowerLine();
  testPreviewReadiness();
  testInferItemTypeFromSavedLine();
  testIsFlowerItemType();
  console.log("purchase-line-form-pure.test.ts: all passed");
}

run();
