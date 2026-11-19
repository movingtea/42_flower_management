import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CostKind, CostStage, LocationKind, LossReason, MaterialKind, PrismaClient,
  ProductionState, RecipeState, ReservationState, TransactionKind,
} from "../../generated/prisma-v2/client";
import { completeProduction } from "./complete-production";
import type { ActualUsageInput } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for actual-usage tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = {
  materialId: string;
  batchId: string;
  skuId: string;
  versionId: string;
};

async function createCatalog(
  label: string,
  onHand: number,
  perUnitQuantity: number,
  unitCost = 2,
  shared?: { materialId: string; batchId: string },
): Promise<Catalog> {
  assert.ok(tenantId && storeId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  let materialId = shared?.materialId;
  let batchId = shared?.batchId;
  if (!materialId || !batchId) {
    const material = await db.material.create({
      data: {
        tenantId, code: `MAT-${code}`, name: `${label} 花材`,
        kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
      },
    });
    materialId = material.id;
    const batch = await db.inventoryBatch.create({
      data: { storeId, materialId, batchNo: `BATCH-${code}`, unitCost },
    });
    batchId = batch.id;
    await db.batchBalance.create({
      data: { batchId, locationId: warehouseId, onHandQty: onHand },
    });
  }
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
      lines: { create: { materialId, plannedQty: perUnitQuantity } },
    },
  });
  return { materialId, batchId, skuId: sku.id, versionId: version.id };
}

async function createDraftOrder(catalog: Catalog, quantity = 1): Promise<string> {
  assert.ok(tenantId && storeId);
  return createManualOrder(db, {
    tenantId, storeId, skuId: catalog.skuId, quantity,
    deliveryAt: futureDate(3), buyerName: "实际用料测试", fulfillmentKind: "PICKUP",
  });
}

async function confirmOrder(orderId: string): Promise<void> {
  assert.ok(tenantId && storeId);
  assert.deepEqual(await confirmManualOrder(db, orderId, tenantId, storeId), {
    covered: true, totalShortage: 0,
  });
}

async function createSampleReservation(batchId: string, quantity: number): Promise<void> {
  assert.ok(tenantId && storeId);
  const plan = await db.samplePlan.create({
    data: { tenantId, storeId, name: `实际用料样品预留-${marker}-${crypto.randomUUID().slice(0, 5)}` },
  });
  const run = await db.samplePlanRun.create({
    data: {
      planId: plan.id, runNo: 1, calculationGroupId: `actual-${marker}-${crypto.randomUUID().slice(0, 5)}`,
      rank: 1, algorithmVersion: "test", requestedSampleCount: 1, lossPolicySnapshot: {},
      candidateSnapshot: {}, inventoryBaselineAt: new Date(), independentCost: 0, totalCost: 0,
      estimatedSaving: 0, reuseRate: 0,
    },
  });
  const execution = await db.samplePlanExecution.create({ data: { planId: plan.id, selectedRunId: run.id } });
  await db.sampleInventoryReservation.create({ data: { executionId: execution.id, batchId, quantity } });
}

async function orderReservations(orderId: string) {
  return db.inventoryReservation.findMany({
    where: { requirement: { orderItem: { orderId } } },
    orderBy: { id: "asc" },
  });
}

async function orderUsages(orderId: string) {
  return db.materialUsage.findMany({
    where: { task: { orderItem: { orderId } } },
    orderBy: { id: "asc" },
  });
}

async function actualCosts(orderId: string) {
  const rows = await db.costEntry.findMany({ where: { orderId, stage: CostStage.ACTUAL } });
  const byKind = new Map<CostKind, number>();
  for (const row of rows) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + Number(row.amount));
  return { rows, byKind };
}

async function batchBalance(batchId: string): Promise<number> {
  const balance = await db.batchBalance.findFirstOrThrow({ where: { batchId } });
  return Number(balance.onHandQty);
}

async function batchTransactions(batchId: string) {
  return db.inventoryTransaction.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
}

function transactionTotals(rows: Awaited<ReturnType<typeof batchTransactions>>) {
  const totals = new Map<TransactionKind, number>();
  for (const row of rows) totals.set(row.kind, (totals.get(row.kind) ?? 0) + Number(row.quantity));
  return totals;
}

async function assertNoWrites(
  orderId: string,
  batchId: string,
  expectedOnHand: number,
  expectedReservationIds: string[],
): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { tasks: true } } } });
  assert.equal(order.productionState, ProductionState.READY);
  assert.ok(order.items.every((item) => item.tasks.every((task) => task.state === ProductionState.READY)));
  assert.equal(await batchBalance(batchId), expectedOnHand);
  assert.equal((await orderUsages(orderId)).length, 0);
  assert.equal(await db.lossRecord.count({ where: { orderId } }), 0);
  assert.equal(await db.costEntry.count({ where: { orderId } }), 0);
  assert.equal((await batchTransactions(batchId)).length, 0);
  const reservations = await orderReservations(orderId);
  assert.deepEqual(
    reservations.filter((row) => row.state === ReservationState.ACTIVE).map((row) => row.id).sort(),
    [...expectedReservationIds].sort(),
  );
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-actual-${marker}`, name: "Phase 1 实际用料测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 实际用料测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  // Default four-argument path: planned reservations are consumed exactly as before.
  const defaultCatalog = await createCatalog("default", 20, 5, 2);
  const defaultOrderId = await createDraftOrder(defaultCatalog);
  await confirmOrder(defaultOrderId);
  const defaultReservations = await orderReservations(defaultOrderId);
  assert.equal(defaultReservations.length, 1);
  assert.equal(Number(defaultReservations[0].quantity), 5);
  await completeProduction(db, defaultOrderId, tenantId, storeId);
  const defaultOrder = await db.order.findUniqueOrThrow({
    where: { id: defaultOrderId },
    include: { items: { include: { tasks: true } } },
  });
  assert.equal(defaultOrder.productionState, ProductionState.COMPLETED);
  assert.equal(defaultOrder.items[0].tasks[0].state, ProductionState.COMPLETED);
  assert.equal(await batchBalance(defaultCatalog.batchId), 15);
  const defaultUsages = await orderUsages(defaultOrderId);
  assert.equal(defaultUsages.length, 1);
  assert.equal(Number(defaultUsages[0].usedQty), 5);
  assert.equal(Number(defaultUsages[0].lostQty), 0);
  assert.equal(Number(defaultUsages[0].returnedQty), 0);
  assert.equal(defaultUsages[0].differenceReason, null);
  assert.equal(await db.lossRecord.count({ where: { orderId: defaultOrderId } }), 0);
  const defaultCosts = await actualCosts(defaultOrderId);
  assert.equal(defaultCosts.byKind.get(CostKind.MATERIAL), 10);
  assert.equal(defaultCosts.byKind.get(CostKind.LOSS), undefined);
  assert.equal(defaultCosts.byKind.get(CostKind.CONSUMABLE), 1);
  assert.equal(defaultCosts.byKind.get(CostKind.LABOR), 2);
  const defaultTransactions = transactionTotals(await batchTransactions(defaultCatalog.batchId));
  assert.deepEqual([...defaultTransactions.keys()].sort(), [TransactionKind.CONSUME, TransactionKind.TRANSFER]);
  assert.equal(defaultTransactions.get(TransactionKind.TRANSFER), 5);
  assert.equal(defaultTransactions.get(TransactionKind.CONSUME), 5);
  assert.ok((await orderReservations(defaultOrderId)).every((row) => row.state === ReservationState.CONSUMED));
  console.log("complete-production default one-click path passed");

  // Higher actual use takes only unreserved stock and records actual material cost.
  const higherCatalog = await createCatalog("higher", 20, 5, 3);
  const higherOrderId = await createDraftOrder(higherCatalog);
  await confirmOrder(higherOrderId);
  await completeProduction(db, higherOrderId, tenantId, storeId, [{
    batchId: higherCatalog.batchId, usedQty: 7, lostQty: 0, returnedQty: 0,
    differenceReason: "现场补用两支",
  }]);
  assert.equal(await batchBalance(higherCatalog.batchId), 13);
  const higherUsages = await orderUsages(higherOrderId);
  assert.equal(higherUsages.length, 1);
  assert.equal(Number(higherUsages[0].usedQty), 7);
  assert.equal(Number(higherUsages[0].lostQty), 0);
  assert.equal(Number(higherUsages[0].returnedQty), 0);
  assert.equal(higherUsages[0].differenceReason, "现场补用两支");
  assert.equal(await db.lossRecord.count({ where: { orderId: higherOrderId } }), 0);
  const higherCosts = await actualCosts(higherOrderId);
  assert.equal(higherCosts.byKind.get(CostKind.MATERIAL), 21);
  assert.equal(higherCosts.byKind.get(CostKind.LOSS), undefined);
  const higherTransactions = transactionTotals(await batchTransactions(higherCatalog.batchId));
  assert.equal(higherTransactions.get(TransactionKind.TRANSFER), 7);
  assert.equal(higherTransactions.get(TransactionKind.CONSUME), 7);
  assert.equal(higherTransactions.get(TransactionKind.LOSS), undefined);
  console.log("complete-production higher actual use passed");

  // Lower actual use keeps the unused reserved quantity in the warehouse and records it as returned.
  const lowerCatalog = await createCatalog("lower", 20, 5, 2);
  const lowerOrderId = await createDraftOrder(lowerCatalog);
  await confirmOrder(lowerOrderId);
  await completeProduction(db, lowerOrderId, tenantId, storeId, [{
    batchId: lowerCatalog.batchId, usedQty: 3, returnedQty: 2, differenceReason: "现场少用两支",
  }]);
  assert.equal(await batchBalance(lowerCatalog.batchId), 17);
  const lowerUsages = await orderUsages(lowerOrderId);
  assert.equal(lowerUsages.length, 1);
  assert.equal(Number(lowerUsages[0].usedQty), 3);
  assert.equal(Number(lowerUsages[0].lostQty), 0);
  assert.equal(Number(lowerUsages[0].returnedQty), 2);
  assert.equal(lowerUsages[0].differenceReason, "现场少用两支");
  assert.equal(await db.lossRecord.count({ where: { orderId: lowerOrderId } }), 0);
  const lowerCosts = await actualCosts(lowerOrderId);
  assert.equal(lowerCosts.byKind.get(CostKind.MATERIAL), 6);
  assert.equal(lowerCosts.byKind.get(CostKind.LOSS), undefined);
  const lowerTransactions = transactionTotals(await batchTransactions(lowerCatalog.batchId));
  assert.equal(lowerTransactions.get(TransactionKind.TRANSFER), 3);
  assert.equal(lowerTransactions.get(TransactionKind.CONSUME), 3);
  assert.equal(lowerTransactions.get(TransactionKind.RETURN), undefined);
  console.log("complete-production lower actual use and returned stock passed");

  // Loss is consumed and expensed separately, never double counted in material.
  const lossCatalog = await createCatalog("loss", 20, 5, 4);
  const lossOrderId = await createDraftOrder(lossCatalog);
  await confirmOrder(lossOrderId);
  await completeProduction(db, lossOrderId, tenantId, storeId, [{
    batchId: lossCatalog.batchId, usedQty: 4, lostQty: 1, returnedQty: 0,
    differenceReason: "修剪损耗一支",
  }]);
  assert.equal(await batchBalance(lossCatalog.batchId), 15);
  const lossUsages = await orderUsages(lossOrderId);
  assert.equal(lossUsages.length, 1);
  assert.equal(Number(lossUsages[0].usedQty), 4);
  assert.equal(Number(lossUsages[0].lostQty), 1);
  assert.equal(Number(lossUsages[0].returnedQty), 0);
  assert.equal(lossUsages[0].differenceReason, "修剪损耗一支");
  const lossRecords = await db.lossRecord.findMany({ where: { orderId: lossOrderId } });
  assert.equal(lossRecords.length, 1);
  assert.equal(lossRecords[0].batchId, lossCatalog.batchId);
  assert.equal(lossRecords[0].reason, LossReason.PRODUCTION_ERROR);
  assert.equal(Number(lossRecords[0].quantity), 1);
  assert.equal(lossRecords[0].note, "修剪损耗一支");
  const lossCosts = await actualCosts(lossOrderId);
  assert.equal(lossCosts.byKind.get(CostKind.MATERIAL), 16);
  assert.equal(lossCosts.byKind.get(CostKind.LOSS), 4);
  const lossTransactions = transactionTotals(await batchTransactions(lossCatalog.batchId));
  assert.equal(lossTransactions.get(TransactionKind.TRANSFER), 5);
  assert.equal(lossTransactions.get(TransactionKind.CONSUME), 5);
  assert.equal(lossTransactions.get(TransactionKind.LOSS), undefined);
  console.log("complete-production loss reconciliation passed");

  // Invalid input must leave the order, stock, reservations, usages, losses and costs untouched.
  const invalidCatalog = await createCatalog("invalid", 20, 5, 2);
  const invalidOrderId = await createDraftOrder(invalidCatalog);
  await confirmOrder(invalidOrderId);
  const invalidReservationIds = (await orderReservations(invalidOrderId))
    .filter((row) => row.state === ReservationState.ACTIVE)
    .map((row) => row.id);
  const foreignCatalog = await createCatalog("foreign", 5, 5, 2);
  const invalidInputs: { input: ActualUsageInput; pattern: RegExp }[] = [
    { input: [{ batchId: invalidCatalog.batchId, usedQty: -1, differenceReason: "负数" }], pattern: /必须为非负/ },
    { input: [{ batchId: invalidCatalog.batchId, usedQty: 1.5, differenceReason: "精度" }], pattern: /不符合物料单位精度/ },
    {
      input: [
        { batchId: invalidCatalog.batchId, usedQty: 5 },
        { batchId: invalidCatalog.batchId, usedQty: 5 },
      ],
      pattern: /批次重复/,
    },
    { input: [{ batchId: foreignCatalog.batchId, usedQty: 5 }], pattern: /非本订单最新预留批次/ },
    { input: [], pattern: /必须全部登记实际用料/ },
    { input: [{ batchId: invalidCatalog.batchId, usedQty: 6, returnedQty: 0 }], pattern: /差异原因/ },
    {
      input: [{ batchId: invalidCatalog.batchId, usedQty: 3, returnedQty: 0, differenceReason: "少用" }],
      pattern: /退料数量/,
    },
  ];
  for (const { input, pattern } of invalidInputs) {
    await assert.rejects(
      completeProduction(db, invalidOrderId, tenantId, storeId, input),
      pattern,
    );
    await assertNoWrites(invalidOrderId, invalidCatalog.batchId, 20, invalidReservationIds);
  }
  await completeProduction(db, invalidOrderId, tenantId, storeId, [{
    batchId: invalidCatalog.batchId, usedQty: 5, lostQty: 0, returnedQty: 0,
  }]);
  assert.equal(await batchBalance(invalidCatalog.batchId), 15);
  assert.equal((await orderUsages(invalidOrderId)).length, 1);
  console.log("complete-production invalid input rollback passed");

  // Higher usage may not consume stock reserved for another order or a sample, and the valid
  // completion leaves those reservations active.
  const sharedCatalog = await createCatalog("shared", 10, 5, 2);
  const targetOrderId = await createDraftOrder(sharedCatalog);
  await confirmOrder(targetOrderId);
  const otherCatalog = await createCatalog("other-reserved", 0, 3, 2, {
    materialId: sharedCatalog.materialId, batchId: sharedCatalog.batchId,
  });
  const otherOrderId = await createDraftOrder(otherCatalog);
  await confirmOrder(otherOrderId);
  await createSampleReservation(sharedCatalog.batchId, 2);
  const otherReservationsBefore = await orderReservations(otherOrderId);
  const sampleReservationsBefore = await db.sampleInventoryReservation.findMany({
    where: { batchId: sharedCatalog.batchId, state: ReservationState.ACTIVE },
  });
  assert.equal(
    otherReservationsBefore.filter((row) => row.state === ReservationState.ACTIVE)
      .reduce((sum, row) => sum + Number(row.quantity), 0),
    3,
  );
  assert.equal(
    sampleReservationsBefore.reduce((sum, row) => sum + Number(row.quantity), 0),
    2,
  );
  const targetReservationIds = (await orderReservations(targetOrderId))
    .filter((row) => row.state === ReservationState.ACTIVE)
    .map((row) => row.id);
  await assert.rejects(completeProduction(db, targetOrderId, tenantId, storeId, [{
    batchId: sharedCatalog.batchId, usedQty: 6, lostQty: 0, returnedQty: 0,
    differenceReason: "补用一支",
  }]), /超出批次可用库存/);
  await assertNoWrites(targetOrderId, sharedCatalog.batchId, 10, targetReservationIds);
  assert.deepEqual(
    (await orderReservations(otherOrderId)).map((row) => [row.id, row.state]).sort(),
    otherReservationsBefore.map((row) => [row.id, row.state]).sort(),
  );
  assert.deepEqual(
    (await db.sampleInventoryReservation.findMany({ where: { batchId: sharedCatalog.batchId } }))
      .map((row) => [row.id, row.state]).sort(),
    sampleReservationsBefore.map((row) => [row.id, row.state]).sort(),
  );

  await completeProduction(db, targetOrderId, tenantId, storeId, [{
    batchId: sharedCatalog.batchId, usedQty: 5, lostQty: 0, returnedQty: 0,
  }]);
  assert.equal(await batchBalance(sharedCatalog.batchId), 5);
  assert.ok((await orderReservations(targetOrderId)).every((row) => row.state === ReservationState.CONSUMED));
  const otherReservationsAfter = await orderReservations(otherOrderId);
  assert.deepEqual(
    otherReservationsAfter.map((row) => [row.id, row.state]).sort(),
    otherReservationsBefore.map((row) => [row.id, row.state]).sort(),
  );
  const sampleReservationsAfter = await db.sampleInventoryReservation.findMany({
    where: { batchId: sharedCatalog.batchId, state: ReservationState.ACTIVE },
  });
  assert.deepEqual(
    sampleReservationsAfter.map((row) => [row.id, row.state]).sort(),
    sampleReservationsBefore.map((row) => [row.id, row.state]).sort(),
  );
  const otherOrder = await db.order.findUniqueOrThrow({
    where: { id: otherOrderId }, include: { items: { include: { tasks: true } } },
  });
  assert.equal(otherOrder.productionState, ProductionState.READY);
  assert.equal(otherOrder.items[0].tasks[0].state, ProductionState.READY);
  assert.equal((await orderUsages(otherOrderId)).length, 0);
  console.log("complete-production preserves other order and sample reservations passed");

  console.log("v2 complete-production actual usage tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.lossRecord.deleteMany({ where: { OR: [{ order: tenants }, { store: tenants }] } });
  await db.costEntry.deleteMany({ where: { order: tenants } });
  await db.materialUsage.deleteMany({ where: { task: { orderItem: { order: tenants } } } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.sampleInventoryReservation.deleteMany({ where: { execution: { plan: tenants } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.samplePlanExecution.deleteMany({ where: { plan: tenants } });
  await db.samplePlanRun.deleteMany({ where: { plan: tenants } });
  await db.samplePlan.deleteMany({ where: tenants });
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
      console.error("complete-production actual cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
