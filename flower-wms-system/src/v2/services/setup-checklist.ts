import type { PrismaClient } from "../../generated/prisma-v2/client";
import { isLowStock } from "../domain/reporting";
import {
  buildV2SetupChecklist,
  type SetupCheckResult,
  type SetupCheckStats,
} from "../domain/setup-checklist";
import { collectDataQualityIssues } from "./data-quality";

export type V2SetupScope = { tenantId: string; storeId: string };

export type SetupChecklistData = {
  result: SetupCheckResult;
  stats: SetupCheckStats;
  generatedAt: Date;
  dataQualityTruncated: boolean;
};

const SEVEN_DAYS_MS = 7 * 86_400_000;

export async function loadSetupChecklist(
  db: PrismaClient,
  scope: V2SetupScope,
  now: Date = new Date(),
): Promise<SetupChecklistData> {
  const soon = new Date(now.getTime() + SEVEN_DAYS_MS);

  const [
    tenantCount,
    storeCount,
    warehouseLocationCount,
    activeMaterialCount,
    flowerMaterialCount,
    flowerMaterialWithCostCount,
    activeMaterialCategoryCount,
    activeSupplierCount,
    activePackagingKitCount,
    packagingKitWithoutLinesCount,
    activeProductCount,
    activeSkuCount,
    activeSkuWithoutRecipeCount,
    publishedRecipeVersionCount,
    publishedRecipeVersionWithoutLinesCount,
    purchaseOrderCount,
    openPurchaseOrderCount,
    receivedPurchaseOrderCount,
    batchWithStockCount,
    expiringBatchCount,
    lowStockMaterials,
    orderCount,
    confirmedOrderCount,
    deliveredOrderCount,
    deliveredWithoutSnapshotCount,
    auditEventCount7d,
    quality,
  ] = await Promise.all([
    db.tenant.count({ where: { id: scope.tenantId } }),
    db.store.count({ where: { tenantId: scope.tenantId } }),
    db.inventoryLocation.count({ where: { storeId: scope.storeId, kind: "WAREHOUSE" } }),
    db.material.count({ where: { tenantId: scope.tenantId, active: true } }),
    db.material.count({
      where: { tenantId: scope.tenantId, active: true, kind: { in: ["FLOWER", "FOLIAGE"] } },
    }),
    db.material.count({
      where: {
        tenantId: scope.tenantId,
        active: true,
        kind: { in: ["FLOWER", "FOLIAGE"] },
        standardUnitCost: { gt: 0 },
      },
    }),
    db.materialCategory.count({ where: { tenantId: scope.tenantId, active: true } }),
    db.supplier.count({ where: { tenantId: scope.tenantId, active: true } }),
    db.packagingKit.count({ where: { tenantId: scope.tenantId, active: true } }),
    db.packagingKit.count({
      where: { tenantId: scope.tenantId, active: true, lines: { none: {} } },
    }),
    db.product.count({ where: { tenantId: scope.tenantId, active: true } }),
    db.productSku.count({ where: { active: true, product: { tenantId: scope.tenantId, active: true } } }),
    db.productSku.count({
      where: {
        active: true,
        product: { tenantId: scope.tenantId, active: true },
        OR: [
          { recipe: { is: null } },
          { recipe: { versions: { none: { state: "PUBLISHED" } } } },
        ],
      },
    }),
    db.recipeVersion.count({
      where: { state: "PUBLISHED", recipe: { sku: { product: { tenantId: scope.tenantId } } } },
    }),
    db.recipeVersion.count({
      where: {
        state: "PUBLISHED",
        lines: { none: {} },
        recipe: { sku: { product: { tenantId: scope.tenantId } } },
      },
    }),
    db.purchaseOrder.count({ where: { tenantId: scope.tenantId, storeId: scope.storeId } }),
    db.purchaseOrder.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        state: { in: ["ORDERED", "PARTIALLY_RECEIVED"] },
      },
    }),
    db.purchaseOrder.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, state: "RECEIVED" },
    }),
    db.inventoryBatch.count({
      where: { storeId: scope.storeId, balances: { some: { onHandQty: { gt: 0 } } } },
    }),
    db.inventoryBatch.count({
      where: {
        storeId: scope.storeId,
        usableUntil: { gte: now, lte: soon },
        balances: { some: { onHandQty: { gt: 0 } } },
      },
    }),
    // Low stock needs the per-material balance sums, so this scan is bounded.
    // It only feeds an advisory checklist count and never blocks a business flow.
    db.material.findMany({
      where: { tenantId: scope.tenantId, active: true },
      select: {
        id: true,
        safetyStockThreshold: true,
        batches: {
          where: { storeId: scope.storeId },
          select: { balances: { select: { onHandQty: true } } },
        },
      },
      take: 2000,
    }),
    db.order.count({ where: { tenantId: scope.tenantId, storeId: scope.storeId } }),
    db.order.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, commercialState: "CONFIRMED" },
    }),
    db.order.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, fulfillmentState: "DELIVERED" },
    }),
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        fulfillmentState: "DELIVERED",
        costSnapshots: { none: {} },
      },
    }),
    db.auditEvent.count({
      where: {
        tenantId: scope.tenantId,
        OR: [{ storeId: scope.storeId }, { storeId: null }],
        occurredAt: { gte: new Date(now.getTime() - SEVEN_DAYS_MS) },
      },
    }),
    collectDataQualityIssues(db, scope, { now, take: 200 }),
  ]);

  const lowStockMaterialCount = lowStockMaterials.filter((material) => {
    const onHand = material.batches.reduce(
      (sum, batch) => sum + batch.balances.reduce((inner, balance) => inner + Number(balance.onHandQty), 0),
      0,
    );
    return isLowStock(onHand, Number(material.safetyStockThreshold));
  }).length;

  const stats: SetupCheckStats = {
    tenantCount,
    storeCount,
    warehouseLocationCount,
    activeMaterialCount,
    flowerMaterialCount,
    flowerMaterialWithCostCount,
    activeMaterialCategoryCount,
    activeSupplierCount,
    activePackagingKitCount,
    packagingKitWithoutLinesCount,
    activeProductCount,
    activeSkuCount,
    activeSkuWithoutRecipeCount,
    publishedRecipeVersionCount,
    publishedRecipeVersionWithoutLinesCount,
    purchaseOrderCount,
    openPurchaseOrderCount,
    receivedPurchaseOrderCount,
    batchWithStockCount,
    expiringBatchCount,
    lowStockMaterialCount,
    orderCount,
    confirmedOrderCount,
    deliveredOrderCount,
    deliveredWithoutSnapshotCount,
    auditEventCount7d,
    criticalDataQualityCount: quality.summary.criticalCount,
  };

  return {
    result: buildV2SetupChecklist(stats),
    stats,
    generatedAt: now,
    dataQualityTruncated: quality.truncated,
  };
}
