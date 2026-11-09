import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CostKind, CostStage, LocationKind, MaterialKind, PrismaClient, RecipeState,
} from "../../generated/prisma-v2/client";
import { completeDelivery } from "./complete-delivery";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { adjustFinalCost } from "./adjust-final-cost";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for final-cost tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = { materialId: string; batchId: string; skuId: string; versionId: string };

async function createCatalog(
  label: string,
  onHand: number,
  unitCost: number,
  perUnitQuantity = 5,
): Promise<Catalog> {
  assert.ok(tenantId && storeId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId, code: `MAT-${code}`, name: `${label} 花材`,
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId, materialId: material.id, batchNo: `BATCH-${code}`, unitCost },
  });
  await db.batchBalance.create({
    data: { batchId: batch.id, locationId: warehouseId, onHandQty: onHand },
  });
  const product = await db.product.create({
    data: { tenantId, code: `PROD-${code}`, name: `${label} 花束` },
  });
  const sku = await db.productSku.create({
    data: {
      productId: product.id, code: `SKU-${code}`, name: "标准款", price: 99,
      estimatedConsumableCost: 1, estimatedLaborCost: 2, active: true,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { active: true, defaultSkuId: sku.id },
  });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  const version = await db.recipeVersion.create({
    data: {
      recipeId: recipe.id, versionNo: 1, state: RecipeState.PUBLISHED, publishedAt: new Date(),
      lines: { create: { materialId: material.id, plannedQty: perUnitQuantity } },
    },
  });
  return { materialId: material.id, batchId: batch.id, skuId: sku.id, versionId: version.id };
}

async function createDraftOrder(catalog: Catalog, quantity = 1): Promise<string> {
  assert.ok(tenantId && storeId);
  return createManualOrder(db, {
    tenantId, storeId, skuId: catalog.skuId, quantity,
    deliveryAt: futureDate(3), buyerName: "最终成本测试", fulfillmentKind: "PICKUP",
  });
}

async function confirmOrder(orderId: string): Promise<void> {
  assert.ok(tenantId && storeId);
  assert.deepEqual(await confirmManualOrder(db, orderId, tenantId, storeId), {
    covered: true, totalShortage: 0,
  });
}

async function produce(
  orderId: string,
  batchId: string,
  usedQty: number,
  lostQty: number,
  returnedQty: number,
  differenceReason?: string,
): Promise<void> {
  assert.ok(tenantId && storeId);
  await completeProduction(db, orderId, tenantId, storeId, [{
    batchId, usedQty, lostQty, returnedQty, differenceReason,
  }]);
}

async function deliver(orderId: string): Promise<void> {
  assert.ok(tenantId && storeId);
  await completeDelivery(db, orderId, tenantId, storeId, `staff-${marker}`);
}

async function actualCosts(orderId: string) {
  const rows = await db.costEntry.findMany({
    where: { orderId, stage: CostStage.ACTUAL },
    orderBy: { id: "asc" },
  });
  const byKind = new Map<CostKind, number>();
  for (const row of rows) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + Number(row.amount));
  return { rows, byKind };
}

async function adjustments(orderId: string) {
  return db.costAdjustment.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-final-cost-${marker}`, name: "Phase 1 最终成本测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 最终成本测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  // One batch feeds both an open order and a closed order.
  const mainCatalog = await createCatalog("main", 100, 2);

  const openOrderId = await createDraftOrder(mainCatalog);
  await confirmOrder(openOrderId);
  await produce(openOrderId, mainCatalog.batchId, 5, 1, 0, "制作损耗一支");

  const closedOrderId = await createDraftOrder(mainCatalog);
  await confirmOrder(closedOrderId);
  await produce(closedOrderId, mainCatalog.batchId, 4, 1, 0, "交付前损耗一支");
  await deliver(closedOrderId);

  const openBefore = await actualCosts(openOrderId);
  assert.equal(openBefore.byKind.get(CostKind.MATERIAL), 10);
  assert.equal(openBefore.byKind.get(CostKind.LOSS), 2);
  assert.ok(openBefore.rows.filter((row) => row.kind === CostKind.MATERIAL || row.kind === CostKind.LOSS)
    .every((row) => row.estimated));

  const closedBefore = await actualCosts(closedOrderId);
  assert.equal(closedBefore.byKind.get(CostKind.MATERIAL), 8);
  assert.equal(closedBefore.byKind.get(CostKind.LOSS), 2);
  const snapshotBefore = await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId: closedOrderId },
    orderBy: { revisionNo: "asc" },
  });
  assert.equal(Number(snapshotBefore.materialCost), 8);
  assert.equal(Number(snapshotBefore.attributedLossCost), 2);
  assert.equal(Number(snapshotBefore.revenue), 99);

  // Invalid input must not touch the batch, entries or adjustments.
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId: crypto.randomUUID(), batchId: mainCatalog.batchId,
    finalUnitCost: 3.5, reason: "错误门店",
  }), /批次不存在/);
  await assert.rejects(adjustFinalCost(db, {
    tenantId: crypto.randomUUID(), storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 3.5, reason: "错误租户",
  }), /批次不存在/);
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: -1, reason: "负数成本",
  }), /不能为负数/);
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 3.12345, reason: "精度过高",
  }), /最多保留四位小数/);
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 3.5, reason: "   ",
  }), /成本调整原因不能为空/);

  const batchBefore = await db.inventoryBatch.findUniqueOrThrow({ where: { id: mainCatalog.batchId } });
  assert.equal(batchBefore.costEstimated, true);
  assert.equal(Number(batchBefore.unitCost), 2);
  assert.equal((await adjustments(openOrderId)).length, 0);
  assert.equal((await adjustments(closedOrderId)).length, 0);
  assert.equal((await actualCosts(openOrderId)).byKind.get(CostKind.MATERIAL), 10);
  assert.equal((await actualCosts(closedOrderId)).byKind.get(CostKind.MATERIAL), 8);

  // Finalize: open order CostEntry is recalculated, closed order gets signed adjustments only.
  const result = await adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 3.5, reason: "采购最终结算",
  });
  assert.equal(result.applied, true);
  assert.equal(result.alreadyFinalized, false);
  assert.equal(result.previousUnitCost, 2);
  assert.equal(result.finalUnitCost, 3.5);
  assert.equal(result.unitCostDelta, 1.5);
  assert.equal(result.openOrders, 1);
  assert.equal(result.closedOrders, 1);
  assert.equal(result.costEntriesUpdated, 2);
  assert.equal(result.adjustmentsCreated, 2);

  const batchAfter = await db.inventoryBatch.findUniqueOrThrow({ where: { id: mainCatalog.batchId } });
  assert.equal(batchAfter.costEstimated, false);
  assert.equal(Number(batchAfter.unitCost), 3.5);

  const openAfter = await actualCosts(openOrderId);
  assert.equal(openAfter.byKind.get(CostKind.MATERIAL), 17.5);
  assert.equal(openAfter.byKind.get(CostKind.LOSS), 3.5);
  assert.equal(openAfter.byKind.get(CostKind.CONSUMABLE), 1);
  assert.equal(openAfter.byKind.get(CostKind.LABOR), 2);
  assert.equal(openAfter.rows.filter((row) => row.kind === CostKind.MATERIAL || row.kind === CostKind.LOSS)
    .every((row) => row.estimated === false), true);
  assert.equal((await adjustments(openOrderId)).length, 0);

  const closedAfter = await actualCosts(closedOrderId);
  assert.equal(closedAfter.byKind.get(CostKind.MATERIAL), 8);
  assert.equal(closedAfter.byKind.get(CostKind.LOSS), 2);
  const closedAdjustments = await adjustments(closedOrderId);
  assert.equal(closedAdjustments.length, 2);
  const materialAdjustment = closedAdjustments.find((row) => row.kind === CostKind.MATERIAL);
  const lossAdjustment = closedAdjustments.find((row) => row.kind === CostKind.LOSS);
  assert.ok(materialAdjustment && lossAdjustment);
  assert.equal(Number(materialAdjustment.amountDelta), 6);
  assert.equal(Number(lossAdjustment.amountDelta), 1.5);
  assert.equal(materialAdjustment.snapshotId, snapshotBefore.id);
  assert.equal(lossAdjustment.snapshotId, snapshotBefore.id);
  assert.equal(materialAdjustment.reason, "采购最终结算");
  assert.equal(lossAdjustment.reason, "采购最终结算");
  assert.equal(materialAdjustment.sourceType, "INVENTORY_BATCH_FINAL_COST");
  assert.equal(materialAdjustment.sourceId, mainCatalog.batchId);

  const snapshotAfter = await db.orderCostSnapshot.findUniqueOrThrow({ where: { id: snapshotBefore.id } });
  assert.equal(Number(snapshotAfter.materialCost), Number(snapshotBefore.materialCost));
  assert.equal(Number(snapshotAfter.attributedLossCost), Number(snapshotBefore.attributedLossCost));
  assert.equal(Number(snapshotAfter.revenue), Number(snapshotBefore.revenue));
  assert.equal(snapshotAfter.closedAt.getTime(), snapshotBefore.closedAt.getTime());
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: closedOrderId } }), 1);

  // Exact retry is a no-op and does not append duplicate adjustments.
  const retry = await adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 3.5, reason: "采购最终结算",
  });
  assert.equal(retry.applied, false);
  assert.equal(retry.alreadyFinalized, true);
  assert.equal((await adjustments(closedOrderId)).length, 2);
  const openRetry = await actualCosts(openOrderId);
  assert.equal(openRetry.rows.length, openAfter.rows.length);
  assert.equal(openRetry.byKind.get(CostKind.MATERIAL), 17.5);
  assert.equal(openRetry.byKind.get(CostKind.LOSS), 3.5);
  assert.equal(Number((await db.inventoryBatch.findUniqueOrThrow({
    where: { id: mainCatalog.batchId },
  })).unitCost), 3.5);

  // A different final cost is rejected once the batch is final.
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId, batchId: mainCatalog.batchId,
    finalUnitCost: 4, reason: "再次修改",
  }), /已最终确认/);
  assert.equal((await adjustments(closedOrderId)).length, 2);

  // Concurrent finalization of one batch: exactly one apply, no duplicate adjustments.
  const concurrentCatalog = await createCatalog("concurrent", 50, 1);
  const concurrentOrderId = await createDraftOrder(concurrentCatalog);
  await confirmOrder(concurrentOrderId);
  await produce(concurrentOrderId, concurrentCatalog.batchId, 2, 0, 3, "现场少用三支");
  await deliver(concurrentOrderId);
  assert.equal(Number((await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId: concurrentOrderId },
  })).materialCost), 2);

  const concurrentResults = await Promise.all([
    adjustFinalCost(db, {
      tenantId, storeId, batchId: concurrentCatalog.batchId,
      finalUnitCost: 2.5, reason: "并发最终结算",
    }),
    adjustFinalCost(db, {
      tenantId, storeId, batchId: concurrentCatalog.batchId,
      finalUnitCost: 2.5, reason: "并发最终结算",
    }),
  ]);
  assert.equal(concurrentResults.filter((row) => row.applied).length, 1);
  assert.equal(concurrentResults.filter((row) => !row.applied).length, 1);
  const concurrentAdjustments = await adjustments(concurrentOrderId);
  assert.equal(concurrentAdjustments.length, 1);
  assert.equal(concurrentAdjustments[0].kind, CostKind.MATERIAL);
  assert.equal(Number(concurrentAdjustments[0].amountDelta), 3);
  assert.equal(Number((await db.inventoryBatch.findUniqueOrThrow({
    where: { id: concurrentCatalog.batchId },
  })).unitCost), 2.5);

  // Invalid input on another open order leaves the transaction untouched.
  const rollbackCatalog = await createCatalog("rollback", 30, 1.5);
  const rollbackOrderId = await createDraftOrder(rollbackCatalog);
  await confirmOrder(rollbackOrderId);
  await produce(rollbackOrderId, rollbackCatalog.batchId, 3, 1, 1, "少用一支并损耗一支");
  const rollbackBefore = await actualCosts(rollbackOrderId);
  assert.equal(rollbackBefore.byKind.get(CostKind.MATERIAL), 4.5);
  assert.equal(rollbackBefore.byKind.get(CostKind.LOSS), 1.5);
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId, batchId: rollbackCatalog.batchId,
    finalUnitCost: Number.NaN, reason: "非法成本",
  }), /有效数字/);
  await assert.rejects(adjustFinalCost(db, {
    tenantId, storeId: crypto.randomUUID(), batchId: rollbackCatalog.batchId,
    finalUnitCost: 2.5, reason: "错误门店",
  }), /批次不存在/);
  const rollbackBatch = await db.inventoryBatch.findUniqueOrThrow({ where: { id: rollbackCatalog.batchId } });
  assert.equal(rollbackBatch.costEstimated, true);
  assert.equal(Number(rollbackBatch.unitCost), 1.5);
  const rollbackAfter = await actualCosts(rollbackOrderId);
  assert.equal(rollbackAfter.byKind.get(CostKind.MATERIAL), 4.5);
  assert.equal(rollbackAfter.byKind.get(CostKind.LOSS), 1.5);
  assert.equal((await adjustments(rollbackOrderId)).length, 0);

  await adjustFinalCost(db, {
    tenantId, storeId, batchId: rollbackCatalog.batchId,
    finalUnitCost: 2.5, reason: "重试后成功结算",
  });
  const rollbackFinal = await actualCosts(rollbackOrderId);
  assert.equal(rollbackFinal.byKind.get(CostKind.MATERIAL), 7.5);
  assert.equal(rollbackFinal.byKind.get(CostKind.LOSS), 2.5);

  // A lower final cost produces signed negative adjustments and reduces open-order entries.
  const decreaseCatalog = await createCatalog("decrease", 20, 1.5);
  const decreaseOpenOrderId = await createDraftOrder(decreaseCatalog);
  await confirmOrder(decreaseOpenOrderId);
  await produce(decreaseOpenOrderId, decreaseCatalog.batchId, 2, 0, 3, "现场少用三支");
  const decreaseClosedOrderId = await createDraftOrder(decreaseCatalog);
  await confirmOrder(decreaseClosedOrderId);
  await produce(decreaseClosedOrderId, decreaseCatalog.batchId, 2, 0, 3, "现场少用三支");
  await deliver(decreaseClosedOrderId);
  assert.equal((await actualCosts(decreaseOpenOrderId)).byKind.get(CostKind.MATERIAL), 3);
  const decreaseSnapshot = await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId: decreaseClosedOrderId },
  });
  assert.equal(Number(decreaseSnapshot.materialCost), 3);
  const decreaseResult = await adjustFinalCost(db, {
    tenantId, storeId, batchId: decreaseCatalog.batchId,
    finalUnitCost: 1, reason: "供应商降价",
  });
  assert.equal(decreaseResult.unitCostDelta, -0.5);
  assert.equal(decreaseResult.costEntriesUpdated, 1);
  assert.equal(decreaseResult.adjustmentsCreated, 1);
  assert.equal((await actualCosts(decreaseOpenOrderId)).byKind.get(CostKind.MATERIAL), 2);
  assert.equal((await actualCosts(decreaseClosedOrderId)).byKind.get(CostKind.MATERIAL), 3);
  const decreaseAdjustments = await adjustments(decreaseClosedOrderId);
  assert.equal(decreaseAdjustments.length, 1);
  assert.equal(decreaseAdjustments[0].kind, CostKind.MATERIAL);
  assert.equal(Number(decreaseAdjustments[0].amountDelta), -1);
  assert.equal(Number((await db.inventoryBatch.findUniqueOrThrow({
    where: { id: decreaseCatalog.batchId },
  })).unitCost), 1);

  console.log("v2 adjust-final-cost tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await db.costAdjustment.deleteMany({ where: { order: tenants } });
  await db.orderCostSnapshot.deleteMany({ where: { order: tenants } });
  await db.costEntry.deleteMany({ where: { order: tenants } });
  await db.materialUsage.deleteMany({ where: { task: { orderItem: { order: tenants } } } });
  await db.lossRecord.deleteMany({ where: { store: tenants } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.recipeLine.deleteMany({ where: { version: { recipe: { sku: { product: tenants } } } } });
  await db.recipeVersion.deleteMany({ where: { recipe: { sku: { product: tenants } } } });
  await db.recipe.deleteMany({ where: { sku: { product: tenants } } });
  await db.product.updateMany({ where: tenants, data: { defaultSkuId: null } });
  await db.productSku.deleteMany({ where: { product: tenants } });
  await db.product.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.inventoryLocation.deleteMany({ where: { store: tenants } });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error("adjust-final-cost cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
