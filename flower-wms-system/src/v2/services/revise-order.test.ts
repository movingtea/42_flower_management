import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, FulfillmentState, LocationKind, MaterialKind, PrismaClient,
  ProductionState, RecipeState, ReservationState, SupplyState,
} from "../../generated/prisma-v2-draft/client";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { reviseManualOrder } from "./revise-order";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for revise-order tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let primaryTenantId: string | undefined;
let secondaryTenantId: string | undefined;
let mainStoreId: string | undefined;
let warehouseId: string | undefined;

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

function loadOrder(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: { include: { requirements: { include: { reservations: true } }, tasks: true } },
      revisions: { orderBy: { number: "asc" } },
      fulfillment: true,
    },
  });
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

function activeTotal(order: LoadedOrder): number {
  return order.items
    .flatMap((item) => item.requirements)
    .flatMap((requirement) => requirement.reservations)
    .filter((reservation) => reservation.state === ReservationState.ACTIVE)
    .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
}

function assertPlanIntact(
  order: LoadedOrder,
  expected: { quantity: number; deliveryAt: Date; activeTotal: number; revisionCount: number },
): void {
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, expected.quantity);
  assert.equal(order.deliveryAt?.getTime(), expected.deliveryAt.getTime());
  assert.equal(order.revisions.length, expected.revisionCount);
  assert.equal(activeTotal(order), expected.activeTotal);
}

async function createCatalog(label: string, onHand: number, perUnitQuantity: number) {
  const code = `${label}-${crypto.randomUUID().slice(0, 8)}`;
  assert.ok(primaryTenantId && mainStoreId && warehouseId);
  const material = await db.material.create({
    data: {
      tenantId: primaryTenantId, code: `MAT-${code}`, name: `${label} 花材`,
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId: mainStoreId, materialId: material.id, batchNo: `BATCH-${code}`, unitCost: 2 },
  });
  await db.batchBalance.create({
    data: { batchId: batch.id, locationId: warehouseId, onHandQty: onHand },
  });
  const product = await db.product.create({
    data: { tenantId: primaryTenantId, code: `PROD-${code}`, name: `${label} 花束` },
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
  return { skuId: sku.id, materialId: material.id, batchId: batch.id, versionId: version.id };
}

async function createDraftOrder(catalog: { skuId: string }, quantity: number): Promise<string> {
  assert.ok(primaryTenantId && mainStoreId);
  return createManualOrder(db, {
    tenantId: primaryTenantId, storeId: mainStoreId, skuId: catalog.skuId, quantity,
    deliveryAt: futureDate(3), buyerName: "改单测试", fulfillmentKind: "PICKUP",
  });
}

async function createSampleReservation(batchId: string, quantity: number): Promise<void> {
  assert.ok(primaryTenantId && mainStoreId);
  const plan = await db.samplePlan.create({
    data: { tenantId: primaryTenantId, storeId: mainStoreId, name: `改单样品预留-${marker}` },
  });
  const run = await db.samplePlanRun.create({
    data: {
      planId: plan.id, runNo: 1, calculationGroupId: `revise-${marker}`, rank: 1, algorithmVersion: "test",
      requestedSampleCount: 1, lossPolicySnapshot: {}, candidateSnapshot: {}, inventoryBaselineAt: new Date(),
      independentCost: 0, totalCost: 0, estimatedSaving: 0, reuseRate: 0,
    },
  });
  const execution = await db.samplePlanExecution.create({
    data: { planId: plan.id, selectedRunId: run.id },
  });
  await db.sampleInventoryReservation.create({
    data: { executionId: execution.id, batchId, quantity },
  });
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `revise-primary-${marker}`, name: "改单测试主租户" },
  });
  primaryTenantId = tenant.id;
  const secondaryTenant = await db.tenant.create({
    data: { slug: `revise-secondary-${marker}`, name: "改单测试其他租户" },
  });
  secondaryTenantId = secondaryTenant.id;
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: "MAIN", name: "改单测试主店" },
  });
  mainStoreId = store.id;
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: "OTHER", name: "改单测试他店" },
  });
  const warehouse = await db.inventoryLocation.create({
    data: { storeId: store.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId: store.id, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  // Draft revision: snapshot, revision and schedule change, but nothing is reserved.
  const draftCatalog = await createCatalog("draft", 10, 2);
  const draftOrderId = await createDraftOrder(draftCatalog, 1);
  const draftDelivery = futureDate(4);
  const draftResult = await reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: draftOrderId, quantity: 2, deliveryAt: draftDelivery,
  });
  assert.equal(draftResult.covered, false);
  assert.equal(draftResult.totalShortage, 0);
  let draft = await loadOrder(draftOrderId);
  assert.equal(draft.commercialState, CommercialState.DRAFT);
  assert.equal(draft.items[0].quantity, 2);
  assert.equal(draft.revisions.length, 2);
  assert.equal(draft.revisions[1].number, 2);
  assert.equal(draft.version, 2);
  assert.equal(draft.deliveryAt?.getTime(), draftDelivery.getTime());
  assert.equal(draft.fulfillment?.scheduledAt?.getTime(), draftDelivery.getTime());
  assert.equal(draft.items[0].requirements.length, 0);
  assert.equal(draft.items[0].tasks.length, 0);
  assert.equal(await db.inventoryReservation.count({
    where: { requirement: { orderItem: { orderId: draftOrderId } } },
  }), 0);

  const draftTask = await db.productionTask.create({
    data: { orderItemId: draft.items[0].id, quantity: 1, state: ProductionState.READY },
  });
  const nextDraftDelivery = futureDate(6);
  await reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: draftOrderId, quantity: 3, deliveryAt: nextDraftDelivery,
  });
  draft = await loadOrder(draftOrderId);
  const updatedDraftTask = await db.productionTask.findUniqueOrThrow({ where: { id: draftTask.id } });
  assert.equal(draft.items[0].quantity, 3);
  assert.equal(draft.revisions.length, 3);
  assert.equal(draft.deliveryAt?.getTime(), nextDraftDelivery.getTime());
  assert.equal(draft.productionState, ProductionState.NOT_SCHEDULED);
  assert.equal(updatedDraftTask.quantity, 3);
  assert.equal(updatedDraftTask.state, ProductionState.NOT_SCHEDULED);
  console.log("revise-order draft revision passed");

  // Covered revision: historical plan stays, current plan is reserved, production consumes only the latest revision.
  const successCatalog = await createCatalog("success", 100, 5);
  const successOrderId = await createDraftOrder(successCatalog, 2);
  assert.deepEqual(await confirmManualOrder(db, successOrderId, tenant.id, store.id), { covered: true, totalShortage: 0 });
  const successBefore = await loadOrder(successOrderId);
  const oldRevisionId = successBefore.revisions[0].id;
  const oldRequirement = successBefore.items[0].requirements.find((entry) => entry.revisionId === oldRevisionId);
  assert.ok(oldRequirement);
  assert.equal(Number(oldRequirement.plannedQty), 10);
  assert.equal(oldRequirement.reservations.filter((entry) => entry.state === ReservationState.ACTIVE).length, 1);

  const successDelivery = futureDate(5);
  const successResult = await reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: successOrderId, quantity: 3, deliveryAt: successDelivery,
  });
  assert.equal(successResult.covered, true);
  assert.equal(successResult.totalShortage, 0);
  assert.equal(successResult.revisionNumber, 2);
  const success = await loadOrder(successOrderId);
  assert.equal(success.commercialState, CommercialState.CONFIRMED);
  assert.equal(success.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(success.productionState, ProductionState.READY);
  assert.equal(success.items[0].quantity, 3);
  assert.equal(success.revisions.length, 2);
  assert.equal(success.version, 2);
  assert.equal(success.deliveryAt?.getTime(), successDelivery.getTime());
  assert.equal(success.fulfillment?.scheduledAt?.getTime(), successDelivery.getTime());
  const historicalRequirement = success.items[0].requirements.find((entry) => entry.revisionId === oldRevisionId);
  assert.ok(historicalRequirement);
  assert.equal(Number(historicalRequirement.plannedQty), 10);
  assert.ok(historicalRequirement.reservations.every((entry) => entry.state === ReservationState.RELEASED));
  const currentRequirements = success.items[0].requirements.filter((entry) => entry.revisionId === successResult.revisionId);
  assert.equal(currentRequirements.length, 1);
  assert.equal(Number(currentRequirements[0].plannedQty), 15);
  assert.equal(
    currentRequirements[0].reservations
      .filter((entry) => entry.state === ReservationState.ACTIVE)
      .reduce((sum, entry) => sum + Number(entry.quantity), 0),
    15,
  );
  assert.equal(success.items[0].tasks[0].quantity, 3);
  assert.equal(success.items[0].tasks[0].state, ProductionState.READY);

  await completeProduction(db, successOrderId, tenant.id, store.id);
  const completed = await db.order.findUniqueOrThrow({
    where: { id: successOrderId },
    include: { items: { include: { tasks: true } } },
  });
  assert.equal(completed.productionState, ProductionState.COMPLETED);
  assert.equal(completed.items[0].tasks[0].state, ProductionState.COMPLETED);
  const remainingBalance = await db.batchBalance.findFirstOrThrow({ where: { batchId: successCatalog.batchId } });
  assert.equal(Number(remainingBalance.onHandQty), 85);
  const usages = await db.materialUsage.findMany({ where: { task: { orderItem: { orderId: successOrderId } } } });
  assert.equal(usages.reduce((sum, usage) => sum + Number(usage.usedQty), 0), 15);
  console.log("revise-order covered revision and latest-revision production passed");

  // Shortage revision: other order and sample reservations are preserved, so the order cannot overbook.
  const shortageCatalog = await createCatalog("shortage", 10, 5);
  const targetOrderId = await createDraftOrder(shortageCatalog, 1);
  assert.deepEqual(await confirmManualOrder(db, targetOrderId, tenant.id, store.id), { covered: true, totalShortage: 0 });
  await createSampleReservation(shortageCatalog.batchId, 2);
  const otherOrderId = await createDraftOrder(shortageCatalog, 1);
  assert.deepEqual(await confirmManualOrder(db, otherOrderId, tenant.id, store.id), { covered: false, totalShortage: 2 });
  const otherActiveBefore = await db.inventoryReservation.findMany({
    where: { requirement: { orderItem: { orderId: otherOrderId } }, state: ReservationState.ACTIVE },
  });
  assert.equal(otherActiveBefore.reduce((sum, entry) => sum + Number(entry.quantity), 0), 3);

  const shortageBefore = await loadOrder(targetOrderId);
  const targetOldRevisionId = shortageBefore.revisions[0].id;
  const shortageDelivery = futureDate(7);
  const shortageResult = await reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: targetOrderId, quantity: 3, deliveryAt: shortageDelivery,
  });
  assert.equal(shortageResult.covered, false);
  assert.equal(shortageResult.totalShortage, 10);
  const shortageAfter = await loadOrder(targetOrderId);
  assert.equal(shortageAfter.commercialState, CommercialState.PENDING_CONFIRMATION);
  assert.equal(shortageAfter.supplyState, SupplyState.PURCHASE_REQUIRED);
  assert.equal(shortageAfter.productionState, ProductionState.WAITING_MATERIAL);
  assert.equal(shortageAfter.items[0].quantity, 3);
  assert.equal(shortageAfter.deliveryAt?.getTime(), shortageDelivery.getTime());
  assert.equal(shortageAfter.fulfillment?.scheduledAt?.getTime(), shortageDelivery.getTime());
  assert.equal(shortageAfter.items[0].tasks[0].quantity, 3);
  assert.equal(shortageAfter.items[0].tasks[0].state, ProductionState.WAITING_MATERIAL);
  const targetHistorical = shortageAfter.items[0].requirements.find((entry) => entry.revisionId === targetOldRevisionId);
  assert.ok(targetHistorical);
  assert.ok(targetHistorical.reservations.every((entry) => entry.state === ReservationState.RELEASED));
  const targetCurrent = shortageAfter.items[0].requirements.find((entry) => entry.revisionId === shortageResult.revisionId);
  assert.ok(targetCurrent);
  assert.equal(Number(targetCurrent.plannedQty), 15);
  assert.equal(
    targetCurrent.reservations
      .filter((entry) => entry.state === ReservationState.ACTIVE)
      .reduce((sum, entry) => sum + Number(entry.quantity), 0),
    5,
  );
  const otherActiveAfter = await db.inventoryReservation.findMany({
    where: { requirement: { orderItem: { orderId: otherOrderId } }, state: ReservationState.ACTIVE },
  });
  assert.deepEqual(
    otherActiveAfter.map((entry) => entry.id).sort(),
    otherActiveBefore.map((entry) => entry.id).sort(),
  );
  const sampleActive = await db.sampleInventoryReservation.findMany({
    where: { batchId: shortageCatalog.batchId, state: ReservationState.ACTIVE },
  });
  assert.equal(sampleActive.reduce((sum, entry) => sum + Number(entry.quantity), 0), 2);
  const orderReserved = await db.inventoryReservation.aggregate({
    where: { batchId: shortageCatalog.batchId, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  assert.equal(Number(orderReserved._sum.quantity ?? 0) + 2, 10);
  console.log("revise-order shortage revision passed");

  // Ownership, input and lifecycle validation keep the old plan untouched.
  const validationCatalog = await createCatalog("validation", 50, 5);
  const validationOrderId = await createDraftOrder(validationCatalog, 1);
  assert.deepEqual(await confirmManualOrder(db, validationOrderId, tenant.id, store.id), { covered: true, totalShortage: 0 });
  const validationBefore = await loadOrder(validationOrderId);
  const validationDelivery = validationBefore.deliveryAt;
  assert.ok(validationDelivery);
  const validationActive = activeTotal(validationBefore);

  await assert.rejects(reviseManualOrder(db, {
    tenantId: secondaryTenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /订单不存在/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: otherStore.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /订单不存在/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 0, deliveryAt: futureDate(4),
  }), /正整数/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 1.5, deliveryAt: futureDate(4),
  }), /正整数/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: new Date(Date.now() - 60_000),
  }), /晚于当前时间/);

  let validationAfter = await loadOrder(validationOrderId);
  assertPlanIntact(validationAfter, {
    quantity: 1, deliveryAt: validationDelivery, activeTotal: validationActive, revisionCount: 1,
  });

  await db.order.update({ where: { id: validationOrderId }, data: { productionState: ProductionState.IN_PROGRESS } });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /已开始制作/);
  await db.order.update({ where: { id: validationOrderId }, data: { productionState: ProductionState.COMPLETED } });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /已开始制作/);
  await db.order.update({
    where: { id: validationOrderId },
    data: { productionState: ProductionState.READY, fulfillmentState: FulfillmentState.DELIVERED },
  });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /已交付/);
  await db.order.update({
    where: { id: validationOrderId },
    data: { fulfillmentState: FulfillmentState.UNPLANNED },
  });
  await db.productionTask.updateMany({
    where: { orderItem: { orderId: validationOrderId } },
    data: { state: ProductionState.IN_PROGRESS, startedAt: new Date() },
  });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: validationOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  }), /已开始制作/);

  validationAfter = await loadOrder(validationOrderId);
  assertPlanIntact(validationAfter, {
    quantity: 1, deliveryAt: validationDelivery, activeTotal: validationActive, revisionCount: 1,
  });
  console.log("revise-order validation and ownership passed");

  // Rollback: a failing replacement plan must leave the old revision, requirements and reservations intact.
  const rollbackCatalog = await createCatalog("rollback", 100, 5);
  const rollbackOrderId = await createDraftOrder(rollbackCatalog, 1);
  assert.deepEqual(await confirmManualOrder(db, rollbackOrderId, tenant.id, store.id), { covered: true, totalShortage: 0 });
  const rollbackBefore = await loadOrder(rollbackOrderId);
  const rollbackDelivery = rollbackBefore.deliveryAt;
  assert.ok(rollbackDelivery);
  const rollbackActive = activeTotal(rollbackBefore);
  const foreignMaterial = await db.material.create({
    data: {
      tenantId: secondaryTenant.id, code: `FOREIGN-${marker}`, name: "其他租户花材",
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  await db.recipeLine.create({
    data: { versionId: rollbackCatalog.versionId, materialId: foreignMaterial.id, plannedQty: 1 },
  });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId: rollbackOrderId,
    quantity: 2, deliveryAt: futureDate(8),
  }), /another tenant/);

  const rollbackAfter = await loadOrder(rollbackOrderId);
  assertPlanIntact(rollbackAfter, {
    quantity: 1, deliveryAt: rollbackDelivery, activeTotal: rollbackActive, revisionCount: 1,
  });
  assert.equal(rollbackAfter.commercialState, CommercialState.CONFIRMED);
  assert.equal(rollbackAfter.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(rollbackAfter.productionState, ProductionState.READY);
  assert.equal(rollbackAfter.items[0].requirements.length, 1);
  assert.equal(rollbackAfter.items[0].tasks[0].quantity, 1);
  assert.equal(rollbackAfter.items[0].tasks[0].state, ProductionState.READY);
  assert.equal(
    await db.orderRevision.count({ where: { orderId: rollbackOrderId } }),
    1,
  );
  console.log("revise-order rollback passed");

  console.log("v2 revise order tests passed");
}

async function cleanup() {
  const tenantIds = [primaryTenantId, secondaryTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
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
      console.error("revise-order cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
