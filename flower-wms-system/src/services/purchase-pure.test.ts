/**
 * Run with:
 *   npx tsx src/services/purchase-pure.test.ts
 */
import assert from "node:assert/strict";
import { PurchaseCostAllocationMethod } from "@/generated/prisma/enums";
import { calculatePurchaseOrderTotals } from "@/services/purchase-pure";

function testSingleLineWithoutExtraFee() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_rose",
        purchaseQuantity: 2,
        purchaseUnit: "扎",
        stemsPerUnit: 20,
        unitPrice: 50,
      },
    ],
  });

  assert.equal(result.goodsAmount.toFixed(2), "100.00");
  assert.equal(result.totalExtraFee.toFixed(2), "0.00");
  assert.equal(result.totalAmount.toFixed(2), "100.00");
  assert.equal(result.lines[0].totalStems.toFixed(2), "40.00");
  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "2.5000");
  assert.equal(result.lines[0].lossAdjustedUnitCost.toFixed(4), "2.9412");
  assert.ok(
    result.warnings.some((warning) => warning.includes("未设置可用率"))
  );
}

function testMultiLineByAmountAllocation() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_rose",
        purchaseQuantity: 2,
        purchaseUnit: "扎",
        stemsPerUnit: 20,
        unitPrice: 50,
      },
      {
        flowerWikiId: "fw_lily",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 10,
        unitPrice: 100,
      },
    ],
    shippingFee: 30,
    packagingFee: 10,
    otherFee: 10,
    allocationMethod: PurchaseCostAllocationMethod.BY_AMOUNT,
  });

  assert.equal(result.goodsAmount.toFixed(2), "200.00");
  assert.equal(result.totalExtraFee.toFixed(2), "50.00");
  assert.equal(result.totalAmount.toFixed(2), "250.00");
  assert.equal(result.lines[0].allocatedExtraFee.toFixed(2), "25.00");
  assert.equal(result.lines[1].allocatedExtraFee.toFixed(2), "25.00");
  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "3.1250");
  assert.equal(result.lines[1].actualUnitCost.toFixed(4), "12.5000");
}

function testGoodsAmountZero() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_free",
        purchaseQuantity: 2,
        purchaseUnit: "扎",
        stemsPerUnit: 10,
        unitPrice: 0,
      },
    ],
    shippingFee: 10,
    allocationMethod: PurchaseCostAllocationMethod.BY_QUANTITY,
  });

  assert.equal(result.goodsAmount.toFixed(2), "0.00");
  assert.equal(result.lines[0].allocatedExtraFee.toFixed(2), "0.00");
  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "0.0000");
  assert.ok(result.warnings.some((warning) => warning.includes("无法分摊")));
}

function testTotalStemsZero() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_zero",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 0,
        unitPrice: 30,
      },
    ],
  });

  assert.equal(result.lines[0].totalStems.toFixed(2), "0.00");
  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "0.0000");
  assert.ok(result.warnings.some((warning) => warning.includes("总支数为 0")));
}

function testDecimalPrecision() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_decimal",
        purchaseQuantity: "3",
        purchaseUnit: "扎",
        stemsPerUnit: "10",
        unitPrice: "0.10",
      },
    ],
    shippingFee: "0.20",
    packagingFee: "0.10",
  });

  assert.equal(result.goodsAmount.toFixed(2), "0.30");
  assert.equal(result.totalExtraFee.toFixed(2), "0.30");
  assert.equal(result.totalAmount.toFixed(2), "0.60");
  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "0.0200");
}

function testLossAdjustedWithExplicitUsableRate() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_rose",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 1,
        unitPrice: 2,
        usableRate: 0.85,
      },
    ],
  });

  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "2.0000");
  assert.equal(result.lines[0].lossAdjustedUnitCost.toFixed(4), "2.3529");
  assert.equal(result.lines[0].lossRate.toFixed(4), "0.1500");
  assert.equal(result.lines[0].lossModelExtraCost.toFixed(2), "0.35");
}

function testMultiLineLossAfterAllocation() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_rose",
        purchaseQuantity: 2,
        purchaseUnit: "扎",
        stemsPerUnit: 20,
        unitPrice: 50,
        usableRate: 0.85,
      },
      {
        flowerWikiId: "fw_lily",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 10,
        unitPrice: 100,
        usableRate: 0.85,
      },
    ],
    shippingFee: 30,
    packagingFee: 10,
    otherFee: 10,
    allocationMethod: PurchaseCostAllocationMethod.BY_AMOUNT,
  });

  assert.equal(result.lines[0].actualUnitCost.toFixed(4), "3.1250");
  assert.equal(result.lines[0].lossAdjustedUnitCost.toFixed(4), "3.6765");
  assert.equal(result.lines[1].actualUnitCost.toFixed(4), "12.5000");
  assert.equal(result.lines[1].lossAdjustedUnitCost.toFixed(4), "14.7059");
}

function testDefaultUsableRateWhenMissing() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_default",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 10,
        unitPrice: 10,
      },
    ],
  });

  assert.equal(result.lines[0].usableRate.toFixed(4), "0.8500");
  assert.ok(
    result.warnings.some((warning) => warning.includes("默认 85%"))
  );
}

function testMissingFeesDefaultToZero() {
  const result = calculatePurchaseOrderTotals({
    lines: [
      {
        flowerWikiId: "fw_default_fee",
        purchaseQuantity: 1,
        purchaseUnit: "扎",
        stemsPerUnit: 5,
        unitPrice: 25,
      },
    ],
  });

  assert.equal(result.shippingFee.toFixed(2), "0.00");
  assert.equal(result.packagingFee.toFixed(2), "0.00");
  assert.equal(result.otherFee.toFixed(2), "0.00");
  assert.equal(result.totalAmount.toFixed(2), "25.00");
}

function run() {
  testSingleLineWithoutExtraFee();
  testMultiLineByAmountAllocation();
  testGoodsAmountZero();
  testTotalStemsZero();
  testDecimalPrecision();
  testLossAdjustedWithExplicitUsableRate();
  testMultiLineLossAfterAllocation();
  testDefaultUsableRateWhenMissing();
  testMissingFeesDefaultToZero();
  console.log("purchase-pure tests passed");
}

run();
