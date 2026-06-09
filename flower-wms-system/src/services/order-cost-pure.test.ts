/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/order-cost-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  calculateFlowerMaterialCostFromInputs,
  calculateGrossValues,
  calculatePackagingCostFromInputs,
  decimalToString,
} from "./order-cost-pure";

function testFlowerSingleBatch() {
  const result = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 10,
      unitCost: "1.50",
      lossAdjustedUnitCost: "1.50",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "15.00");
  assert.equal(decimalToString(result.rawTotalCost), "15.00");
  assert.equal(result.lines[0].rawLineCost, "15.00");
  assert.deepEqual(result.warnings, []);
}

function testFlowerLossAdjustedCost() {
  const result = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 10,
      unitCost: "2.00",
      lossAdjustedUnitCost: "2.3529",
      usableRate: "0.8500",
      lossRate: "0.1500",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
  ]);

  assert.equal(decimalToString(result.rawTotalCost), "20.00");
  assert.equal(decimalToString(result.lossAdjustedTotalCost), "23.50");
  assert.equal(decimalToString(result.lossModelExtraCost), "3.50");
  assert.equal(result.lines[0].lossModelExtraCost, "3.50");
}

function testFlowerFallbackWhenNoLossAdjustedUnitCost() {
  const result = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 5,
      unitCost: "2.00",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
  ]);

  assert.equal(decimalToString(result.lossAdjustedTotalCost), "10.00");
  assert.equal(decimalToString(result.lossModelExtraCost), "0.00");
  assert.ok(
    result.warnings.some((warning) => warning.includes("未设置损耗调整成本"))
  );
}

function testLossAdjustedGrossPreview() {
  const flower = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 10,
      unitCost: "2.00",
      lossAdjustedUnitCost: "2.3529",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
  ]);
  const rawGross = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: flower.rawTotalCost,
    packagingCost: "8.00",
  });
  const adjustedGross = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: flower.lossAdjustedTotalCost,
    packagingCost: "8.00",
  });

  assert.equal(decimalToString(rawGross.totalCost), "28.00");
  assert.equal(decimalToString(adjustedGross.totalCost), "31.50");
  assert.equal(decimalToString(rawGross.grossMargin, 4), "0.7200");
  assert.equal(decimalToString(adjustedGross.grossMargin, 4), "0.6850");
}

function testFlowerMultipleBatches() {
  const result = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 5,
      unitCost: "1.20",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
    {
      stockLogId: "log-2",
      batchId: "batch-2",
      batchNo: "B002",
      quantity: 7,
      unitCost: "1.80",
      materialName: "玫瑰",
      wikiName: "红玫瑰",
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "18.60");
}

function testFlowerNoSaleOut() {
  const result = calculateFlowerMaterialCostFromInputs([]);
  assert.equal(decimalToString(result.totalCost), "0.00");
  assert.equal(result.lines.length, 0);
}

function testFlowerMissingUnitCost() {
  const result = calculateFlowerMaterialCostFromInputs([
    {
      stockLogId: "log-1",
      batchId: "batch-1",
      batchNo: "B001",
      quantity: 5,
      unitCost: null,
      materialName: "尤加利",
      wikiName: null,
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "0.00");
  assert.equal(result.lines[0].unitCost, "0.0000");
  assert.match(result.warnings[0], /缺少 unitCost/);
}

function testPackagingSingleItem() {
  const result = calculatePackagingCostFromInputs([
    {
      orderItemId: "item-1",
      skuId: "sku-1",
      productName: "春日花束",
      specName: "标准",
      quantity: 1,
      recipeId: "recipe-1",
      recipeName: "春日配方",
      packagingKitId: "kit-1",
      packagingKitName: "标准礼赠包装",
      standardCost: "8.00",
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "8.00");
  assert.equal(result.lines[0].lineCost, "8.00");
}

function testPackagingMultipleItemsAndQuantity() {
  const result = calculatePackagingCostFromInputs([
    {
      orderItemId: "item-1",
      skuId: "sku-1",
      productName: "春日花束",
      specName: "标准",
      quantity: 2,
      recipeId: "recipe-1",
      recipeName: "春日配方",
      packagingKitId: "kit-1",
      packagingKitName: "标准礼赠包装",
      standardCost: "8.00",
    },
    {
      orderItemId: "item-2",
      skuId: "sku-2",
      productName: "品牌花盒",
      specName: "大号",
      quantity: 3,
      recipeId: "recipe-2",
      recipeName: "花盒配方",
      packagingKitId: "kit-2",
      packagingKitName: "花盒包装",
      standardCost: "25.00",
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "91.00");
  assert.equal(result.lines.length, 2);
}

function testPackagingNoKitWarning() {
  const result = calculatePackagingCostFromInputs([
    {
      orderItemId: "item-1",
      skuId: "sku-1",
      productName: "春日花束",
      specName: "标准",
      quantity: 1,
      recipeId: "recipe-1",
      recipeName: "春日配方",
      packagingKitId: null,
      packagingKitName: null,
      standardCost: null,
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "0.00");
  assert.equal(result.lines.length, 0);
  assert.match(result.warnings[0], /未绑定包装方案/);
}

function testPackagingNoRecipeWarning() {
  const result = calculatePackagingCostFromInputs([
    {
      orderItemId: "item-1",
      skuId: "sku-1",
      productName: "贺卡",
      specName: "默认",
      quantity: 1,
      recipeId: null,
      recipeName: null,
      packagingKitId: null,
      packagingKitName: null,
      standardCost: null,
    },
  ]);

  assert.equal(decimalToString(result.totalCost), "0.00");
  assert.match(result.warnings[0], /未绑定 Recipe/);
}

function testGrossNormalOrder() {
  const result = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: "18.60",
    packagingCost: "8.00",
  });

  assert.equal(decimalToString(result.totalCost), "26.60");
  assert.equal(decimalToString(result.grossProfit), "73.40");
  assert.equal(decimalToString(result.grossMargin, 4), "0.7340");
}

function testGrossWithDeliveryCost() {
  const result = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: "18.60",
    packagingCost: "8.00",
    deliveryCostActual: "12.00",
  });

  assert.equal(decimalToString(result.totalCost), "38.60");
  assert.equal(decimalToString(result.grossProfit), "61.40");
}

function testGrossZeroPaidAmount() {
  const result = calculateGrossValues({
    paidAmount: 0,
    flowerMaterialCost: "5.00",
    packagingCost: "2.00",
  });

  assert.equal(decimalToString(result.totalCost), "7.00");
  assert.equal(decimalToString(result.grossProfit), "-7.00");
  assert.equal(decimalToString(result.grossMargin, 4), "0.0000");
}

function testUpsertPayloadRecalculationShape() {
  const first = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: "20.00",
    packagingCost: "5.00",
  });
  const second = calculateGrossValues({
    paidAmount: "100.00",
    flowerMaterialCost: "25.00",
    packagingCost: "5.00",
  });

  assert.equal(decimalToString(first.totalCost), "25.00");
  assert.equal(decimalToString(second.totalCost), "30.00");
  assert.equal(decimalToString(second.grossProfit), "70.00");
}

function run() {
  testFlowerSingleBatch();
  testFlowerLossAdjustedCost();
  testFlowerFallbackWhenNoLossAdjustedUnitCost();
  testLossAdjustedGrossPreview();
  testFlowerMultipleBatches();
  testFlowerNoSaleOut();
  testFlowerMissingUnitCost();
  testPackagingSingleItem();
  testPackagingMultipleItemsAndQuantity();
  testPackagingNoKitWarning();
  testPackagingNoRecipeWarning();
  testGrossNormalOrder();
  testGrossWithDeliveryCost();
  testGrossZeroPaidAmount();
  testUpsertPayloadRecalculationShape();
  console.log("order-cost-pure.test.ts — 全部通过");
}

run();
