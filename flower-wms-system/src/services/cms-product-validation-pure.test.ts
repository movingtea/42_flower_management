/**
 * 纯函数单测（无数据库）— 运行：npm run test:cms-validation
 */
import assert from "node:assert/strict";
import { validateProductPublishReadiness } from "./cms-product-validation-pure";

const baseProduct = {
  id: "p1",
  name: "测试花束",
  categoryId: "cat1",
  mainImage: "https://example.com/main.jpg",
  detailImages: ["https://example.com/detail.jpg"],
  description: "描述",
  story: "故事",
  occasionTags: ["BIRTHDAY"],
  colorTags: ["PINK"],
  styleTags: ["KOREAN"],
  relationshipTags: ["FRIEND"],
  budgetTags: ["BUDGET_268_398"],
  positioningTags: ["DAILY_PROMOTE"],
};

const baseSku = {
  id: "s1",
  name: "标准款",
  price: 368,
  isActive: true,
  stock: 10,
  recipeId: "recipe-1",
  marginEstimate: {
    standardGrossMargin: 0.55,
    conservativeGrossMargin: 0.48,
  },
  productDecision: {
    healthStatus: "HEALTHY" as const,
    keyTags: ["HEALTHY_MARGIN"],
  },
};

function testMissingMainImage() {
  const result = validateProductPublishReadiness({
    product: { ...baseProduct, mainImage: "" },
    skus: [baseSku],
  });
  assert.equal(result.canPublish, false);
  assert.ok(
    result.blockingIssues.some((i) => i.code === "MISSING_MAIN_IMAGE")
  );
}

function testNoEnabledSku() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [{ ...baseSku, isActive: false }],
  });
  assert.equal(result.canPublish, false);
  assert.ok(result.blockingIssues.some((i) => i.code === "NO_ENABLED_SKU"));
}

function testNoValidPrice() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [{ ...baseSku, price: 0 }],
  });
  assert.equal(result.canPublish, false);
  assert.ok(result.blockingIssues.some((i) => i.code === "NO_VALID_PRICE"));
}

function testMissingRecipeWarning() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [{ ...baseSku, recipeId: null }],
  });
  assert.equal(result.canPublish, true);
  assert.ok(result.warnings.some((i) => i.code === "MISSING_RECIPE"));
}

function testMissingRecipeBlocker() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [{ ...baseSku, recipeId: null }],
    options: { requireRecipeForPublish: true },
  });
  assert.equal(result.canPublish, false);
  assert.ok(result.blockingIssues.some((i) => i.code === "MISSING_RECIPE"));
}

function testMissingOccasionTags() {
  const result = validateProductPublishReadiness({
    product: { ...baseProduct, occasionTags: [] },
    skus: [baseSku],
  });
  assert.ok(result.warnings.some((i) => i.code === "MISSING_OCCASION_TAGS"));
  assert.equal(result.canPromote, false);
}

function testLowMargin() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [
      {
        ...baseSku,
        marginEstimate: { standardGrossMargin: 0.35 },
      },
    ],
  });
  assert.ok(result.warnings.some((i) => i.code === "LOW_MARGIN"));
}

function testRiskyDecisionCannotPromote() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [
      {
        ...baseSku,
        productDecision: { healthStatus: "RISKY", keyTags: [] },
      },
    ],
  });
  assert.equal(result.canPromote, false);
}

function testCompleteHealthyReady() {
  const result = validateProductPublishReadiness({
    product: baseProduct,
    skus: [baseSku],
  });
  assert.equal(result.overallStatus, "READY");
  assert.equal(result.canPublish, true);
  assert.equal(result.canPromote, true);
  assert.ok(result.score >= 85);
}

function testScoreBoundary() {
  const minimal = validateProductPublishReadiness({
    product: {
      id: "p2",
      name: "",
      categoryId: null,
      mainImage: "",
      detailImages: [],
      description: null,
      story: null,
      occasionTags: [],
      colorTags: [],
      styleTags: [],
      relationshipTags: [],
      budgetTags: [],
      positioningTags: [],
    },
    skus: [],
  });
  assert.equal(minimal.score, 0);
  assert.equal(minimal.canPublish, false);
  assert.equal(minimal.overallStatus, "BLOCKED");
}

function testNullEmptyArraysNoCrash() {
  const result = validateProductPublishReadiness({
    product: {
      id: "p3",
      name: "花",
      categoryId: "c",
      mainImage: "img",
      detailImages: null,
      description: null,
      story: null,
      occasionTags: null,
      colorTags: null,
      styleTags: null,
      relationshipTags: null,
      budgetTags: null,
      positioningTags: null,
    },
    skus: [
      {
        id: "s",
        name: "款",
        price: "299",
        stock: 0,
        recipeId: null,
        marginEstimate: null,
        productDecision: null,
      },
    ],
    options: { allowPreOrder: false },
  });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(typeof result.canPublish, "boolean");
}

function run() {
  testMissingMainImage();
  testNoEnabledSku();
  testNoValidPrice();
  testMissingRecipeWarning();
  testMissingRecipeBlocker();
  testMissingOccasionTags();
  testLowMargin();
  testRiskyDecisionCannotPromote();
  testCompleteHealthyReady();
  testScoreBoundary();
  testNullEmptyArraysNoCrash();
  console.log("cms-product-validation-pure tests passed");
}

run();
