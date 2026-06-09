/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/product-margin-pure.test.ts
 */
import assert from "node:assert/strict";
import { decimalToString } from "./order-cost-pure";
import { LossMode } from "@/generated/prisma/enums";
import {
  calculateMarginFromPrice,
  calculateMaterialLinesByMode,
  calculateStandardMaterialLines,
  getMarginLevel,
  roundFlowerPrice,
  suggestPriceByTargetMargin,
} from "./product-margin-pure";

function testRecipeCostAllMaterialsHaveCost() {
  const result = calculateStandardMaterialLines([
    {
      flowerWikiId: "rose",
      flowerName: "玫瑰",
      quantityNeeded: 10,
      standardUnitCost: "2.50",
    },
    {
      flowerWikiId: "euc",
      flowerName: "尤加利",
      quantityNeeded: 3,
      standardUnitCost: "1.20",
    },
  ]);

  assert.equal(decimalToString(result.materialCost), "28.60");
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.warnings, []);
}

function testRecipeCostMissingMaterialCost() {
  const result = calculateStandardMaterialLines([
    {
      flowerWikiId: "rose",
      flowerName: "玫瑰",
      quantityNeeded: 10,
      standardUnitCost: null,
    },
  ]);

  assert.equal(decimalToString(result.materialCost), "0.00");
  assert.equal(result.lines[0].standardUnitCost, null);
  assert.match(result.warnings[0], /未设置标准单支成本/);
}

function testRecipeCostInvalidQuantity() {
  const result = calculateStandardMaterialLines([
    {
      flowerWikiId: "rose",
      flowerName: "玫瑰",
      quantityNeeded: 0,
      standardUnitCost: "2.50",
    },
  ]);

  assert.equal(decimalToString(result.materialCost), "0.00");
  assert.match(result.warnings[0], /配方用量异常/);
}

function testSkuMarginNormal() {
  const result = calculateMarginFromPrice({
    price: "100.00",
    materialCost: "28.60",
    packagingCost: "8.00",
  });

  assert.equal(decimalToString(result.totalCost), "36.60");
  assert.equal(decimalToString(result.estimatedGrossProfit), "63.40");
  assert.equal(decimalToString(result.estimatedGrossMargin, 4), "0.6340");
}

function testSkuMarginNoRecipeEquivalent() {
  const result = calculateMarginFromPrice({
    price: "100.00",
    materialCost: "0.00",
    packagingCost: "0.00",
  });

  assert.equal(decimalToString(result.totalCost), "0.00");
  assert.equal(decimalToString(result.estimatedGrossMargin, 4), "1.0000");
}

function testSkuPriceZero() {
  const result = calculateMarginFromPrice({
    price: 0,
    materialCost: "20.00",
    packagingCost: "5.00",
  });

  assert.equal(decimalToString(result.estimatedGrossProfit), "-25.00");
  assert.equal(decimalToString(result.estimatedGrossMargin, 4), "0.0000");
  assert.match(result.warnings[0], /售价为 0/);
}

function testSuggestPriceByTargetMargin() {
  const result = suggestPriceByTargetMargin("100.00");

  assert.deepEqual(
    result.map((row) => row.targetMargin),
    ["0.4500", "0.5500", "0.6000", "0.6500"]
  );
  assert.deepEqual(
    result.map((row) => row.price),
    ["179.00", "219.00", "249.00", "288.00"]
  );
}

function testSuggestPriceZeroAndInvalidTarget() {
  const result = suggestPriceByTargetMargin("0.00", [0.45, 1, -0.1]);
  assert.equal(result.length, 1);
  assert.equal(result[0].price, "0.00");
}

function testRoundFlowerPrice() {
  assert.equal(decimalToString(roundFlowerPrice("96.00")), "99.00");
  assert.equal(decimalToString(roundFlowerPrice("166.00")), "168.00");
  assert.equal(decimalToString(roundFlowerPrice("397.00")), "398.00");
  assert.equal(decimalToString(roundFlowerPrice("642.00")), "640.00");
}

function testLossModelThreeTiers() {
  const input = [
    {
      flowerWikiId: "rose",
      flowerName: "玫瑰",
      quantityNeeded: 10,
      standardUnitCost: "2.00",
      lossProfile: {
        optimisticUsableRate: 0.92,
        standardUsableRate: 0.85,
        conservativeUsableRate: 0.75,
      },
    },
  ];

  const optimistic = calculateMaterialLinesByMode(input, LossMode.OPTIMISTIC);
  const standard = calculateMaterialLinesByMode(input, LossMode.STANDARD);
  const conservative = calculateMaterialLinesByMode(input, LossMode.CONSERVATIVE);
  const raw = calculateMaterialLinesByMode(input, "RAW");

  assert.equal(decimalToString(raw.rawMaterialCost), "20.00");
  assert.ok(
    conservative.materialCost.greaterThan(standard.materialCost)
  );
  assert.ok(standard.materialCost.greaterThan(optimistic.materialCost));
  assert.ok(optimistic.materialCost.greaterThan(raw.rawMaterialCost));
}

function testLossModelMarginOrdering() {
  const materialCost = (mode: typeof LossMode.STANDARD) =>
    calculateMaterialLinesByMode(
      [
        {
          flowerWikiId: "rose",
          flowerName: "玫瑰",
          quantityNeeded: 10,
          standardUnitCost: "2.00",
          lossProfile: {
            optimisticUsableRate: 0.92,
            standardUsableRate: 0.85,
            conservativeUsableRate: 0.75,
          },
        },
      ],
      mode
    ).materialCost;

  const price = "100.00";
  const packaging = "0.00";
  const optimisticMargin = calculateMarginFromPrice({
    price,
    materialCost: materialCost(LossMode.OPTIMISTIC),
    packagingCost: packaging,
  }).estimatedGrossMargin;
  const standardMargin = calculateMarginFromPrice({
    price,
    materialCost: materialCost(LossMode.STANDARD),
    packagingCost: packaging,
  }).estimatedGrossMargin;
  const conservativeMargin = calculateMarginFromPrice({
    price,
    materialCost: materialCost(LossMode.CONSERVATIVE),
    packagingCost: packaging,
  }).estimatedGrossMargin;

  assert.ok(conservativeMargin.lessThan(standardMargin));
  assert.ok(standardMargin.lessThan(optimisticMargin));
}

function testMissingUsableRateFallback() {
  const result = calculateMaterialLinesByMode(
    [
      {
        flowerWikiId: "rose",
        flowerName: "玫瑰",
        quantityNeeded: 10,
        standardUnitCost: "2.00",
      },
    ],
    LossMode.STANDARD
  );

  assert.equal(result.lines[0].usableRate, "0.8500");
  assert.ok(
    result.warnings.some((warning) => warning.includes("未设置可用率"))
  );
}

function testMissingStandardUnitCostWarning() {
  const result = calculateMaterialLinesByMode(
    [
      {
        flowerWikiId: "rose",
        flowerName: "玫瑰",
        quantityNeeded: 10,
        standardUnitCost: null,
      },
    ],
    LossMode.STANDARD
  );

  assert.equal(decimalToString(result.materialCost), "0.00");
  assert.ok(
    result.warnings.some((warning) => warning.includes("未设置标准单支成本"))
  );
}

function testMarginLevel() {
  assert.equal(getMarginLevel("0.20"), "低毛利");
  assert.equal(getMarginLevel("0.50"), "健康");
  assert.equal(getMarginLevel("0.65"), "优秀");
  assert.equal(
    getMarginLevel("0.75"),
    "高毛利，需检查定价或成本是否漏填"
  );
}

function run() {
  testRecipeCostAllMaterialsHaveCost();
  testRecipeCostMissingMaterialCost();
  testRecipeCostInvalidQuantity();
  testSkuMarginNormal();
  testSkuMarginNoRecipeEquivalent();
  testSkuPriceZero();
  testSuggestPriceByTargetMargin();
  testSuggestPriceZeroAndInvalidTarget();
  testRoundFlowerPrice();
  testLossModelThreeTiers();
  testLossModelMarginOrdering();
  testMissingUsableRateFallback();
  testMissingStandardUnitCostWarning();
  testMarginLevel();
  console.log("product-margin-pure.test.ts — 全部通过");
}

run();
