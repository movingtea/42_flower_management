import assert from "node:assert/strict";
import { buildV2SetupChecklist, type SetupCheckStats } from "./setup-checklist";

function stats(overrides: Partial<SetupCheckStats> = {}): SetupCheckStats {
  return {
    tenantCount: 1,
    storeCount: 1,
    warehouseLocationCount: 1,
    activeMaterialCount: 20,
    flowerMaterialCount: 10,
    flowerMaterialWithCostCount: 9,
    activeMaterialCategoryCount: 3,
    activeSupplierCount: 2,
    activePackagingKitCount: 2,
    packagingKitWithoutLinesCount: 0,
    activeProductCount: 4,
    activeSkuCount: 6,
    activeSkuWithoutRecipeCount: 0,
    publishedRecipeVersionCount: 6,
    publishedRecipeVersionWithoutLinesCount: 0,
    purchaseOrderCount: 5,
    openPurchaseOrderCount: 1,
    receivedPurchaseOrderCount: 4,
    batchWithStockCount: 8,
    expiringBatchCount: 0,
    lowStockMaterialCount: 0,
    orderCount: 10,
    confirmedOrderCount: 8,
    deliveredOrderCount: 6,
    deliveredWithoutSnapshotCount: 0,
    auditEventCount7d: 12,
    criticalDataQualityCount: 0,
    ...overrides,
  };
}

function testHealthy() {
  const result = buildV2SetupChecklist(stats());
  // The system-health item is an explicit manual step, so the overall result
  // is a warning even when every data check passes.
  assert.equal(result.summary.overallStatus, "WARNING");
  assert.equal(result.sections.length, 6);
  assert.equal(
    result.sections.filter((section) => section.key !== "launch_readiness").every((section) => section.status === "PASS"),
    true,
  );
  assert.equal(result.sections.find((section) => section.key === "launch_readiness")?.status, "WARNING");
  assert.equal(result.nextActions.length, 1);
  assert.equal(result.nextActions[0].actionHref, "/v2/system-health");
  assert.ok(result.summary.completionRate > 80);
}

function testEmpty() {
  const result = buildV2SetupChecklist(
    stats({
      tenantCount: 0,
      storeCount: 0,
      warehouseLocationCount: 0,
      activeMaterialCount: 0,
      flowerMaterialCount: 0,
      flowerMaterialWithCostCount: 0,
      activeMaterialCategoryCount: 0,
      activeSupplierCount: 0,
      activePackagingKitCount: 0,
      activeProductCount: 0,
      activeSkuCount: 0,
      activeSkuWithoutRecipeCount: 0,
      publishedRecipeVersionCount: 0,
      purchaseOrderCount: 0,
      openPurchaseOrderCount: 0,
      receivedPurchaseOrderCount: 0,
      batchWithStockCount: 0,
      orderCount: 0,
      confirmedOrderCount: 0,
      deliveredOrderCount: 0,
      deliveredWithoutSnapshotCount: 0,
      auditEventCount7d: 0,
      criticalDataQualityCount: 0,
    }),
  );
  assert.equal(result.summary.overallStatus, "CRITICAL");
  assert.ok(result.summary.criticalCount > 0);
  assert.equal(result.sections[0].status, "CRITICAL");
  assert.ok(result.nextActions.length <= 5);
}

function testWarningsAndCritical() {
  const result = buildV2SetupChecklist(
    stats({
      activeSkuWithoutRecipeCount: 2,
      publishedRecipeVersionWithoutLinesCount: 1,
      deliveredWithoutSnapshotCount: 3,
      criticalDataQualityCount: 4,
      expiringBatchCount: 2,
      lowStockMaterialCount: 3,
      activeSupplierCount: 1,
    }),
  );
  const recipe = result.sections.find((section) => section.key === "catalog_recipe")!;
  assert.equal(recipe.status, "CRITICAL");
  const supply = result.sections.find((section) => section.key === "supply_chain")!;
  assert.equal(supply.status, "WARNING");
  const orders = result.sections.find((section) => section.key === "orders_cost")!;
  assert.equal(orders.status, "CRITICAL");
  const readiness = result.sections.find((section) => section.key === "launch_readiness")!;
  assert.equal(readiness.status, "CRITICAL");
  assert.equal(result.summary.overallStatus, "CRITICAL");
  assert.equal(result.nextActions[0].severity, "critical");
}

function testSeverityMatchesStatus() {
  const result = buildV2SetupChecklist(
    stats({
      activeSkuCount: 0,
      activeSkuWithoutRecipeCount: 0,
      publishedRecipeVersionCount: 0,
      activePackagingKitCount: 0,
      packagingKitWithoutLinesCount: 0,
    }),
  );
  const items = result.sections.flatMap((section) => section.items);
  const skuRecipe = items.find((entry) => entry.key === "sku_recipe")!;
  assert.equal(skuRecipe.status, "NOT_STARTED");
  assert.equal(skuRecipe.severity, "warning");

  const recipeLines = items.find((entry) => entry.key === "recipe_lines")!;
  assert.equal(recipeLines.status, "NOT_STARTED");
  assert.equal(recipeLines.severity, "warning");

  const packaging = items.find((entry) => entry.key === "packaging_kits")!;
  assert.equal(packaging.status, "WARNING");
  assert.equal(packaging.severity, "warning");

  // A "success" severity must never sit next to a non-PASS status.
  for (const item of items) {
    if (item.status !== "PASS") {
      assert.notEqual(item.severity, "success", `${item.key} severity mismatch`);
    }
  }
}

function testLowStockWarning() {
  const withLowStock = buildV2SetupChecklist(stats({ lowStockMaterialCount: 12 }));
  const lowStock = withLowStock.sections
    .flatMap((section) => section.items)
    .find((entry) => entry.key === "low_stock")!;
  assert.equal(lowStock.status, "WARNING");
  assert.equal(lowStock.severity, "warning");
  assert.match(lowStock.message, /12 种物料低于安全库存/);
}

function run() {
  testHealthy();
  testEmpty();
  testWarningsAndCritical();
  testSeverityMatchesStatus();
  testLowStockWarning();
  console.log("v2 setup checklist domain tests passed");
}

run();
