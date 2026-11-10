import { MaterialKind, RecipeState } from "../../../src/generated/prisma-v2/client";
import type { SeedBaseline, SeedTransaction } from "./types";

/**
 * `p1-scenarios` tier: deterministic reference data reusable by E1.1 P1
 * scenarios, service tests and E2E flows.
 *
 * Contract:
 * - fixed codes/version numbers only; no Date.now(), random values or UUID
 *   literals are used to identify rows (the database generates opaque ids);
 * - no order, hold, reservation, purchase or production transactions are
 *   created here - tests and E1.5 create those;
 * - re-applying the tier restores the canonical reference state (counts and
 *   business fields), so repeat runs stay idempotent;
 * - everything lives in the baseline tenant, with the optional stock batch in
 *   the baseline MAIN store.
 */

export const P1_SUPPLIER_CODE = "P1-SUP-001";
export const P1_SUPPLIER_NAME = "P1 参考供应商";

export const P1_FLOWER_MATERIAL_CODE = "P1-MAT-ROSE";
export const P1_FLOWER_MATERIAL_NAME = "P1 参考红玫瑰";
export const P1_CONSUMABLE_MATERIAL_CODE = "P1-MAT-WRAP";
export const P1_CONSUMABLE_MATERIAL_NAME = "P1 参考雾面包装纸";

export const P1_PRODUCT_CODE = "P1-SPU-BOUQUET";
export const P1_PRODUCT_NAME = "P1 参考花束";
export const P1_SKU_CODE = "P1-SKU-BOUQUET-M";
export const P1_SKU_NAME = "P1 参考花束 · 标准款";
export const P1_SKU_PRICE = 199;
export const P1_SKU_ESTIMATED_CONSUMABLE_COST = 50;
export const P1_SKU_ESTIMATED_LABOR_COST = 30;

export const P1_RECIPE_VERSION_NO = 1;
/** Fixed reference timestamps keep the fixture byte-for-byte repeatable. */
export const P1_RECIPE_EFFECTIVE_AT = new Date("2026-01-03T00:00:00.000Z");
export const P1_RECIPE_PUBLISHED_AT = new Date("2026-01-03T00:00:00.000Z");

export const P1_BATCH_NO = "P1-BATCH-ROSE-001";
export const P1_BATCH_RECEIVED_AT = new Date("2026-01-02T00:00:00.000Z");
export const P1_BATCH_ON_HAND_QTY = 50;
export const P1_BATCH_UNIT_COST = 2.5;

export type P1ScenarioRefs = {
  supplierId: string;
  flowerMaterialId: string;
  consumableMaterialId: string;
  productId: string;
  skuId: string;
  recipeId: string;
  recipeVersionId: string;
  batchId: string;
};

type P1RecipeLine = {
  materialId: string;
  plannedQty: number;
  toleranceQty: number;
  expectedLossRate: number;
};

export async function applyP1Scenarios(
  db: SeedTransaction,
  baseline: SeedBaseline,
): Promise<P1ScenarioRefs> {
  const supplier = await db.supplier.upsert({
    where: { tenantId_code: { tenantId: baseline.tenantId, code: P1_SUPPLIER_CODE } },
    create: {
      tenantId: baseline.tenantId,
      code: P1_SUPPLIER_CODE,
      name: P1_SUPPLIER_NAME,
      contactName: "P1 联系人",
      notes: "E1.4 p1-scenarios 固定参考数据（测试库）",
    },
    update: {
      name: P1_SUPPLIER_NAME,
      contactName: "P1 联系人",
      notes: "E1.4 p1-scenarios 固定参考数据（测试库）",
      active: true,
    },
  });

  const flower = await db.material.upsert({
    where: {
      tenantId_code: { tenantId: baseline.tenantId, code: P1_FLOWER_MATERIAL_CODE },
    },
    create: {
      tenantId: baseline.tenantId,
      code: P1_FLOWER_MATERIAL_CODE,
      name: P1_FLOWER_MATERIAL_NAME,
      kind: MaterialKind.FLOWER,
      color: "红",
      grade: "A",
      gradeSpecification: "A 级",
      specification: "40cm",
      baseUnit: "支",
      quantityScale: 0,
      reservePerOrder: true,
      active: true,
    },
    update: {
      name: P1_FLOWER_MATERIAL_NAME,
      kind: MaterialKind.FLOWER,
      color: "红",
      grade: "A",
      gradeSpecification: "A 级",
      specification: "40cm",
      baseUnit: "支",
      quantityScale: 0,
      reservePerOrder: true,
      active: true,
    },
  });

  const consumable = await db.material.upsert({
    where: {
      tenantId_code: {
        tenantId: baseline.tenantId,
        code: P1_CONSUMABLE_MATERIAL_CODE,
      },
    },
    create: {
      tenantId: baseline.tenantId,
      code: P1_CONSUMABLE_MATERIAL_CODE,
      name: P1_CONSUMABLE_MATERIAL_NAME,
      kind: MaterialKind.CONSUMABLE,
      baseUnit: "张",
      quantityScale: 0,
      reservePerOrder: false,
      active: true,
    },
    update: {
      name: P1_CONSUMABLE_MATERIAL_NAME,
      kind: MaterialKind.CONSUMABLE,
      baseUnit: "张",
      quantityScale: 0,
      reservePerOrder: false,
      active: true,
    },
  });

  // Create the product disabled first: an active product requires an active
  // default SKU, so the SKU is upserted before the product is promoted.
  const product = await db.product.upsert({
    where: { tenantId_code: { tenantId: baseline.tenantId, code: P1_PRODUCT_CODE } },
    create: {
      tenantId: baseline.tenantId,
      code: P1_PRODUCT_CODE,
      name: P1_PRODUCT_NAME,
      active: false,
    },
    update: { name: P1_PRODUCT_NAME },
  });
  const sku = await db.productSku.upsert({
    where: { productId_code: { productId: product.id, code: P1_SKU_CODE } },
    create: {
      productId: product.id,
      code: P1_SKU_CODE,
      name: P1_SKU_NAME,
      price: P1_SKU_PRICE,
      estimatedConsumableCost: P1_SKU_ESTIMATED_CONSUMABLE_COST,
      estimatedLaborCost: P1_SKU_ESTIMATED_LABOR_COST,
      active: true,
    },
    update: {
      name: P1_SKU_NAME,
      price: P1_SKU_PRICE,
      estimatedConsumableCost: P1_SKU_ESTIMATED_CONSUMABLE_COST,
      estimatedLaborCost: P1_SKU_ESTIMATED_LABOR_COST,
      active: true,
      sourceSampleId: null,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { name: P1_PRODUCT_NAME, active: true, defaultSkuId: sku.id },
  });

  const recipe = await db.recipe.upsert({
    where: { skuId: sku.id },
    create: { skuId: sku.id },
    update: {},
  });
  const recipeVersion = await db.recipeVersion.upsert({
    where: {
      recipeId_versionNo: {
        recipeId: recipe.id,
        versionNo: P1_RECIPE_VERSION_NO,
      },
    },
    create: {
      recipeId: recipe.id,
      versionNo: P1_RECIPE_VERSION_NO,
      state: RecipeState.PUBLISHED,
      effectiveAt: P1_RECIPE_EFFECTIVE_AT,
      publishedAt: P1_RECIPE_PUBLISHED_AT,
    },
    update: {
      state: RecipeState.PUBLISHED,
      effectiveAt: P1_RECIPE_EFFECTIVE_AT,
      publishedAt: P1_RECIPE_PUBLISHED_AT,
    },
  });

  const recipeLines: readonly P1RecipeLine[] = [
    {
      materialId: flower.id,
      plannedQty: 11,
      toleranceQty: 0,
      expectedLossRate: 0.05,
    },
    {
      materialId: consumable.id,
      plannedQty: 2,
      toleranceQty: 0,
      expectedLossRate: 0,
    },
  ];
  for (const line of recipeLines) {
    const existing = await db.recipeLine.findFirst({
      where: { versionId: recipeVersion.id, materialId: line.materialId },
      select: { id: true },
    });
    if (existing) {
      await db.recipeLine.update({
        where: { id: existing.id },
        data: {
          plannedQty: line.plannedQty,
          toleranceQty: line.toleranceQty,
          expectedLossRate: line.expectedLossRate,
        },
      });
    } else {
      await db.recipeLine.create({
        data: {
          versionId: recipeVersion.id,
          materialId: line.materialId,
          plannedQty: line.plannedQty,
          toleranceQty: line.toleranceQty,
          expectedLossRate: line.expectedLossRate,
        },
      });
    }
  }
  await db.recipeLine.deleteMany({
    where: {
      versionId: recipeVersion.id,
      materialId: { notIn: recipeLines.map((line) => line.materialId) },
    },
  });

  const batch = await db.inventoryBatch.upsert({
    where: {
      storeId_batchNo: { storeId: baseline.storeId, batchNo: P1_BATCH_NO },
    },
    create: {
      storeId: baseline.storeId,
      materialId: flower.id,
      batchNo: P1_BATCH_NO,
      receivedAt: P1_BATCH_RECEIVED_AT,
      usableUntil: null,
      unitCost: P1_BATCH_UNIT_COST,
      costEstimated: true,
    },
    update: {
      materialId: flower.id,
      unitCost: P1_BATCH_UNIT_COST,
      costEstimated: true,
    },
  });
  // Existing balances are intentionally preserved: consuming fixture stock
  // during a test run must not be silently reset by a later seed invocation.
  await db.batchBalance.upsert({
    where: {
      batchId_locationId: {
        batchId: batch.id,
        locationId: baseline.stockLocationId,
      },
    },
    create: {
      batchId: batch.id,
      locationId: baseline.stockLocationId,
      onHandQty: P1_BATCH_ON_HAND_QTY,
      frozenQty: 0,
    },
    update: {},
  });

  return {
    supplierId: supplier.id,
    flowerMaterialId: flower.id,
    consumableMaterialId: consumable.id,
    productId: product.id,
    skuId: sku.id,
    recipeId: recipe.id,
    recipeVersionId: recipeVersion.id,
    batchId: batch.id,
  };
}
