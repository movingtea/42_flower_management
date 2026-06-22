/**
 * Run with:
 *   npx tsx src/lib/purchase-line-source-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  assertFlowerHasNoMasterPart,
  assertMasterPartTypeMatchesItemType,
  assertNonFlowerHasNoFlowerWiki,
  buildPurchaseLineSourcePayload,
  formatMasterPartOptionLabel,
  normalizeFlowerWikiIdForLine,
  normalizeMasterPartIdForLine,
  parsePurchaseLineItemTypeStrict,
  resolvePersistedPurchaseLineItemType,
  resolvePurchaseLineDisplay,
} from "@/lib/purchase-line-source-pure";
import {
  DEFAULT_PURCHASE_LINE_ITEM_TYPE,
  getPurchaseLineVisibleFields,
  isFlowerPurchaseLineItemType,
} from "@/lib/purchase-line-form-pure";

function testDefaultItemType() {
  assert.equal(parsePurchaseLineItemTypeStrict(undefined), "FLOWER");
  assert.equal(parsePurchaseLineItemTypeStrict(""), "FLOWER");
  assert.equal(
    resolvePersistedPurchaseLineItemType({ flowerWikiId: "fw-1" }),
    "FLOWER"
  );
}

function testInvalidItemType() {
  assert.throws(
    () => parsePurchaseLineItemTypeStrict("INVALID"),
    /采购品类无效/
  );
}

function testFlowerRequiresFlowerWikiId() {
  assert.throws(
    () => normalizeFlowerWikiIdForLine("", "FLOWER"),
    /花材明细必须选择花材母表/
  );
  assert.equal(normalizeFlowerWikiIdForLine("fw-1", "FLOWER"), "fw-1");
  assert.equal(normalizeFlowerWikiIdForLine("fw-1", "PACKAGING"), null);
}

function testNonFlowerRequiresMasterPartId() {
  assert.throws(
    () => normalizeMasterPartIdForLine("", "PACKAGING"),
    /非花材明细必须选择通用物料母表/
  );
  assert.equal(normalizeMasterPartIdForLine("mp-1", "PACKAGING"), "mp-1");
  assert.equal(normalizeMasterPartIdForLine("mp-1", "FLOWER"), null);
}

function testCrossSourceGuards() {
  assert.throws(
    () => assertNonFlowerHasNoFlowerWiki("PACKAGING", "fw-1", "第 1 行："),
    /不能关联花材母表/
  );
  assert.throws(
    () => assertFlowerHasNoMasterPart("FLOWER", "mp-1", "第 1 行："),
    /不能关联通用物料母表/
  );
  assert.doesNotThrow(() =>
    assertNonFlowerHasNoFlowerWiki("FLOWER", "fw-1", "第 1 行：")
  );
  assert.doesNotThrow(() =>
    assertFlowerHasNoMasterPart("PACKAGING", "mp-1", "第 1 行：")
  );
  assert.throws(
    () => assertMasterPartTypeMatchesItemType("SUPPLY", "PACKAGING", "第 1 行："),
    /类型与采购品类不一致/
  );
}

function testBuildPayloadDualSource() {
  const flower = buildPurchaseLineSourcePayload({
    itemType: "FLOWER",
    flowerWikiId: "fw-1",
    masterPartId: "mp-should-ignore",
    purchaseName: "红玫瑰",
    grade: "A",
    color: "红",
    spec: "ignored",
    purchaseQuantity: "2",
    purchaseUnit: "扎",
    stemsPerUnit: "10",
    unitPrice: "50",
    usableRate: "90",
    note: "",
  });
  assert.equal(flower.flowerWikiId, "fw-1");
  assert.equal(flower.masterPartId, null);
  assert.equal(flower.spec, null);
  assert.equal(flower.usableRate, "90");

  const packaging = buildPurchaseLineSourcePayload({
    itemType: "PACKAGING",
    flowerWikiId: "fw-should-ignore",
    masterPartId: "mp-1",
    purchaseName: "",
    grade: "A",
    color: "红",
    spec: "50×70cm",
    purchaseQuantity: "100",
    purchaseUnit: "张",
    stemsPerUnit: "10",
    unitPrice: "1.5",
    usableRate: "90",
    note: "",
  });
  assert.equal(packaging.flowerWikiId, null);
  assert.equal(packaging.masterPartId, "mp-1");
  assert.equal(packaging.spec, "50×70cm");
  assert.equal(packaging.usableRate, "100");
  assert.equal(packaging.stemsPerUnit, "10");
}

function testDisplayFields() {
  const flower = resolvePurchaseLineDisplay({
    itemType: "FLOWER",
    purchaseName: "进口红玫瑰",
    grade: "A",
    color: "红",
    purchaseUnit: "扎",
    flowerWiki: { chineseName: "玫瑰", englishName: "Rose" },
  });
  assert.equal(flower.displayName, "进口红玫瑰");
  assert.equal(flower.displaySpec, "A / 红 / 扎");

  const packaging = resolvePurchaseLineDisplay({
    itemType: "PACKAGING",
    masterPart: { name: "韩素纸", spec: "50×70cm", defaultUnit: "张" },
  });
  assert.equal(packaging.displayName, "韩素纸");
  assert.equal(packaging.displaySpec, "50×70cm");
}

function testMasterPartOptionLabel() {
  assert.equal(
    formatMasterPartOptionLabel({
      name: "韩素纸",
      spec: "50×70cm",
      defaultUnit: "张",
    }),
    "韩素纸 / 50×70cm / 张"
  );
}

function testNonFlowerFieldVisibility() {
  for (const itemType of ["SUPPLY", "PACKAGING", "TOOL", "OTHER"] as const) {
    const fields = getPurchaseLineVisibleFields(itemType);
    assert.ok(fields.includes("masterPartSelect"), itemType);
    assert.ok(fields.includes("spec"), itemType);
    assert.ok(!fields.includes("flowerSelect"), itemType);
    assert.ok(!fields.includes("usableRate"), itemType);
    assert.equal(isFlowerPurchaseLineItemType(itemType), false);
  }
  assert.equal(DEFAULT_PURCHASE_LINE_ITEM_TYPE, "FLOWER");
}

function run() {
  testDefaultItemType();
  testInvalidItemType();
  testFlowerRequiresFlowerWikiId();
  testNonFlowerRequiresMasterPartId();
  testCrossSourceGuards();
  testBuildPayloadDualSource();
  testDisplayFields();
  testMasterPartOptionLabel();
  testNonFlowerFieldVisibility();
  console.log("purchase-line-source-pure.test.ts: all passed");
}

run();
