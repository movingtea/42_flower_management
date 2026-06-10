/**
 * 运行：npm run test:setup-checklist
 */
import assert from "node:assert/strict";
import {
  buildSetupChecklist,
  computeSetupCompletionRate,
  type SetupChecklistStats,
} from "@/services/setup-checklist-pure";

function baseStats(overrides: Partial<SetupChecklistStats> = {}): SetupChecklistStats {
  return {
    flowerWikiTotal: 0,
    flowerWikiWithCost: 0,
    flowerWikiWithUsableRate: 0,
    supplierActiveCount: 0,
    packagingKitActiveCount: 0,
    recipeCount: 0,
    recipeWithoutLines: 0,
    recipeWithoutPackaging: 0,
    activeProductCount: 0,
    activeProductWithoutSku: 0,
    activeSkuWithoutRecipe: 0,
    activeSkuWithoutImage: 0,
    activeProductWithoutOccasionTags: 0,
    activeProductWithoutCategory: 0,
    homeMainSlotItemCount: 0,
    sceneSlotCount: 0,
    sceneSlotEmptyCount: 0,
    homeSceneEntryActiveCount: 0,
    homeSceneUsingFallback: true,
    localhostImageCount: 0,
    orderTotalCount: 0,
    paidOrderCount: 0,
    paidOrderWithoutSnapshot: 0,
    miniprogramProductCount: 0,
    miniprogramCategoryCount: 0,
    ...overrides,
  };
}

function testNoFlowerWiki() {
  const result = buildSetupChecklist(baseStats());
  const wiki = result.sections.find((s) => s.key === "flower_wiki");
  assert.equal(wiki?.status, "NOT_STARTED");
  assert.ok(wiki?.items.some((i) => i.severity === "critical"));
}

function testSkuWithoutRecipeWarning() {
  const result = buildSetupChecklist(
    baseStats({
      flowerWikiTotal: 25,
      flowerWikiWithCost: 22,
      flowerWikiWithUsableRate: 22,
      supplierActiveCount: 2,
      packagingKitActiveCount: 3,
      recipeCount: 5,
      activeProductCount: 5,
      activeSkuWithoutRecipe: 2,
    })
  );
  const cms = result.sections.find((s) => s.key === "cms_product");
  assert.ok(cms?.items.some((i) => i.key === "cms_sku_recipe" && i.status === "WARNING"));
}

function testEmptyRecommendationWarning() {
  const result = buildSetupChecklist(
    baseStats({
      flowerWikiTotal: 25,
      flowerWikiWithCost: 22,
      flowerWikiWithUsableRate: 22,
      supplierActiveCount: 2,
      packagingKitActiveCount: 3,
      recipeCount: 5,
      activeProductCount: 5,
      homeMainSlotItemCount: 0,
    })
  );
  const rec = result.sections.find((s) => s.key === "cms_recommendation");
  assert.ok(rec?.items.some((i) => i.key === "rec_home_main" && i.status === "WARNING"));
}

function testLocalhostCritical() {
  const result = buildSetupChecklist(
    baseStats({
      flowerWikiTotal: 25,
      flowerWikiWithCost: 22,
      flowerWikiWithUsableRate: 22,
      supplierActiveCount: 2,
      packagingKitActiveCount: 3,
      recipeCount: 5,
      activeProductCount: 5,
      localhostImageCount: 3,
    })
  );
  const image = result.sections.find((s) => s.key === "image_url");
  assert.equal(image?.status, "CRITICAL");
}

function testHomeSceneFallbackWarning() {
  const result = buildSetupChecklist(
    baseStats({
      flowerWikiTotal: 25,
      flowerWikiWithCost: 22,
      flowerWikiWithUsableRate: 22,
      supplierActiveCount: 2,
      packagingKitActiveCount: 3,
      recipeCount: 5,
      activeProductCount: 5,
      homeSceneEntryActiveCount: 0,
      homeSceneUsingFallback: true,
    })
  );
  const scene = result.sections.find((s) => s.key === "home_scene");
  assert.equal(scene?.items[0]?.status, "WARNING");
  assert.match(scene?.items[0]?.message ?? "", /fallback/);
}

function testCompletionRate() {
  assert.equal(computeSetupCompletionRate(8, 10), 80);
  assert.equal(computeSetupCompletionRate(0, 0), 0);
}

function run() {
  testNoFlowerWiki();
  testSkuWithoutRecipeWarning();
  testEmptyRecommendationWarning();
  testLocalhostCritical();
  testHomeSceneFallbackWarning();
  testCompletionRate();
  console.log("setup-checklist-pure.test.ts: all passed");
}

run();
