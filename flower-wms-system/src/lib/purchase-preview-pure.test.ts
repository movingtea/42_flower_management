/**
 * Run with:
 *   npx tsx src/lib/purchase-preview-pure.test.ts
 */
import assert from "node:assert/strict";
import { calculatePurchaseOrderTotals } from "@/services/purchase-pure";
import { mapPurchasePreviewApiError } from "@/lib/purchase-api-error";
import {
  assertPreviewFlowerWikiReferences,
  assertPreviewMasterPartReferences,
  collectFlowerWikiIdsForPreview,
  collectMasterPartIdsForPreview,
  parsePurchasePreviewLine,
} from "@/lib/purchase-preview-pure";

function testFlowerPreviewLineParse() {
  const line = parsePurchasePreviewLine(
    {
      itemType: "FLOWER",
      flowerWikiId: "fw-1",
      purchaseQuantity: "2",
      purchaseUnit: "扎",
      stemsPerUnit: "10",
      unitPrice: "50",
    },
    0
  );
  assert.equal(line.itemType, "FLOWER");
  assert.equal(line.flowerWikiId, "fw-1");
  assert.equal(line.masterPartId, null);
}

function testPackagingPreviewLineParse() {
  const line = parsePurchasePreviewLine(
    {
      itemType: "PACKAGING",
      masterPartId: "mp-1",
      purchaseQuantity: "100",
      purchaseUnit: "张",
      unitPrice: "1.5",
    },
    0
  );
  assert.equal(line.itemType, "PACKAGING");
  assert.equal(line.masterPartId, "mp-1");
  assert.equal(line.flowerWikiId, null);
}

function testLegacyFlowerPayloadParse() {
  const line = parsePurchasePreviewLine(
    {
      flowerWikiId: "fw-legacy",
      purchaseQuantity: "1",
      purchaseUnit: "扎",
      stemsPerUnit: "10",
      unitPrice: "20",
    },
    0
  );
  assert.equal(line.itemType, "FLOWER");
  assert.equal(line.flowerWikiId, "fw-legacy");
}

function testMissingMasterPartIdFails() {
  assert.throws(
    () =>
      parsePurchasePreviewLine(
        {
          itemType: "SUPPLY",
          purchaseQuantity: "1",
          purchaseUnit: "卷",
          unitPrice: "10",
        },
        0
      ),
    /非花材明细必须选择通用物料母表/
  );
}

function testMasterPartTypeMismatchFails() {
  assert.throws(
    () =>
      assertPreviewMasterPartReferences({
        lines: [{ itemType: "PACKAGING", flowerWikiId: null, masterPartId: "mp-1" }],
        masterParts: [{ id: "mp-1", type: "TOOL", isActive: true }],
      }),
    /类型与采购品类不一致/
  );
}

function testCollectIdsOnlyForMatchingItemTypes() {
  const lines = [
    { itemType: "FLOWER" as const, flowerWikiId: "fw-1", masterPartId: null },
    { itemType: "PACKAGING" as const, flowerWikiId: null, masterPartId: "mp-1" },
  ];
  assert.deepEqual(collectFlowerWikiIdsForPreview(lines), ["fw-1"]);
  assert.deepEqual(collectMasterPartIdsForPreview(lines), ["mp-1"]);
}

function testMixedPreviewTotals() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        itemType: "FLOWER",
        flowerWikiId: "fw-1",
        purchaseQuantity: 2,
        purchaseUnit: "扎",
        stemsPerUnit: 10,
        unitPrice: 50,
        usableRate: 1,
      },
      {
        itemType: "PACKAGING",
        masterPartId: "mp-1",
        purchaseQuantity: 100,
        purchaseUnit: "张",
        stemsPerUnit: 1,
        unitPrice: 1.5,
        usableRate: 1,
      },
    ],
    shippingFee: 10,
  });
  assert.equal(result.goodsAmount.toFixed(2), "250.00");
  assert.equal(result.totalAmount.toFixed(2), "260.00");
  assert.equal(result.lines[0].lineAmount.toFixed(2), "100.00");
  assert.equal(result.lines[1].lineAmount.toFixed(2), "150.00");
  assert.ok(
    !result.warnings.some((warning) => warning.includes("花材未设置可用率") && warning.includes("第 2 行"))
  );
}

function testNonFlowerDoesNotNeedFlowerWikiReference() {
  assert.doesNotThrow(() =>
    assertPreviewFlowerWikiReferences({
      lines: [{ itemType: "TOOL", flowerWikiId: null, masterPartId: "mp-1" }],
      wikiIds: [],
    })
  );
}

function testPreviewApiErrorMaps404To400() {
  const mapped = mapPurchasePreviewApiError(new Error("花材不存在，请先在花材母表中创建"));
  assert.equal(mapped.status, 400);
}

function run() {
  testFlowerPreviewLineParse();
  testPackagingPreviewLineParse();
  testLegacyFlowerPayloadParse();
  testMissingMasterPartIdFails();
  testMasterPartTypeMismatchFails();
  testCollectIdsOnlyForMatchingItemTypes();
  testMixedPreviewTotals();
  testNonFlowerDoesNotNeedFlowerWikiReference();
  testPreviewApiErrorMaps404To400();
  console.log("purchase-preview-pure.test.ts: all passed");
}

run();
