import assert from "node:assert/strict";
import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import { parseCmsProductBody } from "@/lib/cms-products";
import {
  countEnabledSkus,
  createDefaultSkuDraftRow,
  DEFAULT_SINGLE_SPEC_NAME,
  formatMiniprogramSpecLabel,
  isDefaultSingleSpecName,
  isSingleSpecProduct,
  resolveSkuSpecNameForSave,
  shouldShowMiniprogramSpecSelector,
} from "./single-spec-product";

const categories: CmsProductCategoryItem[] = [
  { id: "cat-1", name: "测试", isActive: true, sortOrder: 0 },
];

function testDefaultDraft() {
  const row = createDefaultSkuDraftRow();
  assert.equal(row.specName, DEFAULT_SINGLE_SPEC_NAME);
  assert.equal(row.isMainImage, true);
  assert.equal(row.isActive, true);
}

function testSingleSpecDetection() {
  assert.equal(isSingleSpecProduct(1), true);
  assert.equal(isSingleSpecProduct(2), false);
  assert.equal(shouldShowMiniprogramSpecSelector(1), false);
  assert.equal(shouldShowMiniprogramSpecSelector(2), true);
}

function testResolveSpecName() {
  assert.equal(resolveSkuSpecNameForSave("", 1, 0), DEFAULT_SINGLE_SPEC_NAME);
  assert.equal(resolveSkuSpecNameForSave("  大号  ", 1, 0), "大号");
  assert.throws(
    () => resolveSkuSpecNameForSave("", 2, 1),
    /须填写款式品名/
  );
}

function testParseBodySingleSpecEmptyName() {
  const body = parseCmsProductBody(
    {
      name: "测试花束",
      category: ["cat-1"],
      skus: [{ specName: "", price: 99, stock: 5, isMainImage: true }],
    },
    categories
  );
  assert.equal(body.skus.length, 1);
  assert.equal(body.skus[0].specName, DEFAULT_SINGLE_SPEC_NAME);
}

function testMiniprogramSpecLabel() {
  assert.equal(formatMiniprogramSpecLabel("单规格", 1), "");
  assert.equal(formatMiniprogramSpecLabel("标准款", 1), "");
  assert.equal(formatMiniprogramSpecLabel("大号", 2), "大号");
}

function testEnabledCount() {
  assert.equal(
    countEnabledSkus([{ isActive: true }, { isActive: false }]),
    1
  );
}

function testLegacyNames() {
  assert.equal(isDefaultSingleSpecName("标准款"), true);
  assert.equal(isDefaultSingleSpecName("大号"), false);
}

testDefaultDraft();
testSingleSpecDetection();
testResolveSpecName();
testParseBodySingleSpecEmptyName();
testMiniprogramSpecLabel();
testEnabledCount();
testLegacyNames();

console.log("single-spec-product.test.ts: all passed");
