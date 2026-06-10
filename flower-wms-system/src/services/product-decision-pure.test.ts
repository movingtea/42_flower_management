/**
 * 纯函数单测（无数据库）— 运行：npm run test:product-decision
 */
import assert from "node:assert/strict";
import { decimalToString } from "./order-cost-pure";
import {
  calculateCostStructureRisk,
  calculateLossSensitivity,
  calculateSuggestedPricesByTargetMargins,
  evaluateProductHealth,
} from "./product-decision-pure";

function testLossSensitivityHigh() {
  const result = calculateLossSensitivity({
    optimisticGrossMargin: 0.68,
    standardGrossMargin: 0.62,
    conservativeGrossMargin: 0.55,
  });

  assert.equal(result.totalMarginDrop, 0.13);
  assert.equal(result.sensitivityLevel, "HIGH");
  assert.equal(result.marginDropFromOptimisticToStandard, 0.06);
  assert.equal(result.marginDropFromStandardToConservative, 0.07);
}

function testLossSensitivityLow() {
  const result = calculateLossSensitivity({
    optimisticGrossMargin: 0.62,
    standardGrossMargin: 0.6,
    conservativeGrossMargin: 0.58,
  });

  assert.equal(result.totalMarginDrop, 0.04);
  assert.equal(result.sensitivityLevel, "LOW");
}

function testLossSensitivityMissingData() {
  const result = calculateLossSensitivity({
    optimisticGrossMargin: 0.62,
    standardGrossMargin: null,
    conservativeGrossMargin: 0.55,
  });

  assert.equal(result.sensitivityLevel, "UNKNOWN");
  assert.equal(result.totalMarginDrop, null);
  assert.match(result.warnings[0], /不完整/);
}

function testSuggestedPricesTargetMargin60() {
  const result = calculateSuggestedPricesByTargetMargins({
    standardTotalCost: 140,
    targetMargins: [0.6],
  });

  const standard = result.find(
    (item) => item.basedOnMode === "STANDARD" && item.targetMargin === 0.6
  );
  assert.ok(standard);
  assert.equal(standard.suggestedPrice, "350.00");
  assert.equal(standard.roundedSuggestedPrice, "350.00");
}

function testSuggestedPricesBoundaryMargins() {
  const result = calculateSuggestedPricesByTargetMargins({
    standardTotalCost: 100,
    targetMargins: [0, 0.5, 1, 0.6],
  });

  assert.equal(result.length, 2);
  assert.ok(result.some((item) => item.targetMargin === 0.5));
  assert.ok(result.some((item) => item.targetMargin === 0.6));
}

function testSuggestedPricesRounding() {
  const result = calculateSuggestedPricesByTargetMargins({
    standardTotalCost: 36.6,
    targetMargins: [0.6],
  });

  const standard = result[0];
  assert.equal(standard.suggestedPrice, "91.50");
  assert.equal(standard.roundedSuggestedPrice, "99.00");
}

function testEvaluateHealthMissingRecipe() {
  const result = evaluateProductHealth({
    salesAmount: 0,
    orderCount: 0,
    hasRecipe: false,
    hasCompleteCostData: false,
    isActive: true,
    productPrice: 100,
    standardTotalCost: 0,
    conservativeTotalCost: 0,
  });

  assert.equal(result.healthStatus, "INCOMPLETE_DATA");
  assert.ok(result.tags.some((tag) => tag.key === "MISSING_RECIPE"));
}

function testEvaluateHealthLowMargin() {
  const result = evaluateProductHealth({
    salesAmount: 1000,
    orderCount: 5,
    standardGrossMargin: 0.35,
    conservativeGrossMargin: 0.3,
    hasRecipe: true,
    hasCompleteCostData: true,
    isActive: true,
    productPrice: 100,
    standardTotalCost: 65,
    conservativeTotalCost: 70,
  });

  assert.equal(result.healthStatus, "RISKY");
  assert.ok(result.tags.some((tag) => tag.key === "HIGH_LOSS_SENSITIVITY"));
}

function testEvaluateHealthStandardLowMargin() {
  const result = evaluateProductHealth({
    salesAmount: 1000,
    orderCount: 5,
    standardGrossMargin: 0.38,
    conservativeGrossMargin: 0.36,
    hasRecipe: true,
    hasCompleteCostData: true,
    isActive: true,
    productPrice: 100,
    standardTotalCost: 62,
    conservativeTotalCost: 64,
  });

  assert.equal(result.healthStatus, "LOW_MARGIN");
  assert.ok(result.tags.some((tag) => tag.key === "LOW_MARGIN"));
}

function testEvaluateHealthRecommended() {
  const result = evaluateProductHealth({
    salesAmount: 2000,
    orderCount: 5,
    standardGrossMargin: 0.58,
    conservativeGrossMargin: 0.48,
    hasRecipe: true,
    hasCompleteCostData: true,
    isActive: true,
    productPrice: 200,
    standardTotalCost: 84,
    conservativeTotalCost: 104,
  });

  assert.equal(result.healthStatus, "RECOMMENDED");
  assert.ok(result.tags.some((tag) => tag.key === "RECOMMEND_PROMOTE"));
}

function testEvaluateHealthInsufficientOrders() {
  const result = evaluateProductHealth({
    salesAmount: 100,
    orderCount: 1,
    standardGrossMargin: 0.55,
    conservativeGrossMargin: 0.5,
    hasRecipe: true,
    hasCompleteCostData: true,
    isActive: true,
    productPrice: 100,
    standardTotalCost: 45,
    conservativeTotalCost: 50,
  });

  assert.equal(result.healthStatus, "OBSERVE");
  assert.ok(result.tags.some((tag) => tag.key === "DATA_INSUFFICIENT"));
}

function testEvaluateHealthPackagingCostRisk() {
  const result = evaluateProductHealth({
    salesAmount: 500,
    orderCount: 3,
    standardGrossMargin: 0.52,
    conservativeGrossMargin: 0.46,
    hasRecipe: true,
    hasCompleteCostData: true,
    isActive: true,
    productPrice: 150,
    standardTotalCost: 72,
    conservativeTotalCost: 81,
    packagingCostRatio: 0.3,
  });

  assert.ok(result.tags.some((tag) => tag.key === "PACKAGING_COST_RISK"));
  assert.ok(result.warnings.some((warning) => /包装成本/.test(warning)));
}

function testCostStructurePackagingRisk() {
  const result = calculateCostStructureRisk({
    materialCost: 50,
    packagingCost: 30,
    totalCost: 100,
    lossModelExtraCost: 5,
  });

  assert.equal(result.packagingCostRatio, 0.3);
  assert.ok(result.riskTags.some((tag) => tag.key === "PACKAGING_COST_RISK"));
}

function testCostStructureLossExtraRisk() {
  const result = calculateCostStructureRisk({
    materialCost: 60,
    packagingCost: 10,
    totalCost: 100,
    lossModelExtraCost: 20,
  });

  assert.equal(result.lossExtraCostRatio, 0.2);
  assert.ok(result.riskTags.some((tag) => tag.key === "HIGH_LOSS_SENSITIVITY"));
}

function testCostStructureZeroTotalCost() {
  const result = calculateCostStructureRisk({
    materialCost: 0,
    packagingCost: 0,
    totalCost: 0,
    lossModelExtraCost: 0,
  });

  assert.equal(result.materialCostRatio, null);
  assert.equal(result.packagingCostRatio, null);
  assert.equal(result.lossExtraCostRatio, null);
  assert.match(result.warnings[0], /总成本为 0/);
}

function run() {
  testLossSensitivityHigh();
  testLossSensitivityLow();
  testLossSensitivityMissingData();
  testSuggestedPricesTargetMargin60();
  testSuggestedPricesBoundaryMargins();
  testSuggestedPricesRounding();
  testEvaluateHealthMissingRecipe();
  testEvaluateHealthLowMargin();
  testEvaluateHealthStandardLowMargin();
  testEvaluateHealthRecommended();
  testEvaluateHealthInsufficientOrders();
  testEvaluateHealthPackagingCostRisk();
  testCostStructurePackagingRisk();
  testCostStructureLossExtraRisk();
  testCostStructureZeroTotalCost();
  console.log("product-decision-pure tests passed");
}

run();
