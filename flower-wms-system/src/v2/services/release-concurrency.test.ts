import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, LossReason, MaterialKind, PrismaClient, ProductionState, RecipeState,
  ReservationState, SupplyState, TransactionKind,
} from "../../generated/prisma-v2/client";
import { completeProduction } from "./complete-production";
import type { InventoryOperationScope } from "./inventory-operations";
import { recordLoss, type RecordLossInput } from "./loss-management";
import { confirmManualOrder, createManualOrder } from "./manual-order";

/**
 * Release-candidate concurrency evidence for inventory mutations.
 *
 * Every scenario uses the real PostgreSQL schema and the real services. No service is mocked and
 * no write is simulated: each call opens its own Prisma transaction and every assertion reads the
 * committed database rows afterwards.
 *
 * Deadline: the services use a 30s transaction timeout. Each competing call is additionally bounded
 * by a 45s test deadline so a lock-order bug surfaces as a failed test instead of an infinite run.
 * There is deliberately no automatic retry: the inventory writers share the lock order
 * Store -> Batch -> BatchBalance (reservation uses the same batch lock), so a deadlock would be a
 * defect that must be seen, not masked.
 */
config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("V2_DATABASE_URL or DATABASE_URL is required for release concurrency tests");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);
const TEST_DEADLINE_MS = 45_000;

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = {
  materialId: string;
  batchId: string;
  skuId: string;
  versionId: string;
};

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}: exceeded ${TEST_DEADLINE_MS}ms, possible lock deadlock`));
    }, TEST_DEADLINE_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function fulfilledValue<T>(result: PromiseSettledResult<T>, label: string): T {
  assert.equal(
    result.status,
    "fulfilled",
    `${label} should have succeeded but was rejected: ${result.status === "rejected" ? String(result.reason) : ""}`,
  );
  return result.value;
}

function quantity(value: unknown): number {
  return Number(value ?? 0);
}

async function createCatalog(
  label: string,
  onHand: number,
  perUnitQuantity: number,
  unitCost = 2,
): Promise<Catalog> {
  assert.ok(tenantId && storeId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId,
      code: `MAT-${code}`,
      name: `${label} 花材`,
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 0,
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
      productId: product.id,
      code: `SKU-${code}`,
      name: "标准款",
      price: 99,
      estimatedConsumableCost: 1,
      estimatedLaborCost: 2,
      active: true,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { active: true, defaultSkuId: sku.id },
  });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  const version = await db.recipeVersion.create({
    data: {
      recipeId: recipe.id,
      versionNo: 1,
      state: RecipeState.PUBLISHED,
      publishedAt: new Date(),
      lines: { create: { materialId: material.id, plannedQty: perUnitQuantity } },
    },
  });
  return { materialId: material.id, batchId: batch.id, skuId: sku.id, versionId: version.id };
}

async function createDraftOrder(catalog: Catalog, quantity = 1): Promise<string> {
  assert.ok(tenantId && storeId);
  return createManualOrder(db, {
    tenantId,
    storeId,
    skuId: catalog.skuId,
    quantity,
    deliveryAt: futureDate(3),
    buyerName: "并发预留测试",
    fulfillmentKind: "PICKUP",
  });
}

async function confirmOrder(orderId: string): Promise<void> {
  assert.ok(tenantId && storeId);
  await confirmManualOrder(db, orderId, tenantId, storeId);
}

async function balanceQty(batchId: string, locationId: string): Promise<number> {
  const balance = await db.batchBalance.findUnique({
    where: { batchId_locationId: { batchId, locationId } },
  });
  return quantity(balance?.onHandQty);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `s3d-concurrency-${marker}`, name: "S3-D 并发测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: `MAIN-${marker}`, name: "S3-D 并发测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: `STOCK-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: `PRODUCTION-${marker}`, kind: LocationKind.PRODUCTION },
  });
  const scope: InventoryOperationScope = {
    tenantId,
    storeId,
    actorStaffId: `staff-s3d-${marker}`,
  };

  // 1) Three orders request 6 each from one batch holding 10. The batch row lock serializes
  // reservation, so active reservations total exactly the on-hand quantity and the remaining
  // demand stays visible as shortage instead of overselling.
  const reservationCatalog = await createCatalog("reserve", 10, 6);
  const reservationOrderIds = await Promise.all([
    createDraftOrder(reservationCatalog),
    createDraftOrder(reservationCatalog),
    createDraftOrder(reservationCatalog),
  ]);
  const confirmResults = await Promise.allSettled(reservationOrderIds.map((orderId) =>
    withDeadline(confirmOrder(orderId), `confirm ${orderId}`)));
  for (const [index, result] of confirmResults.entries()) {
    fulfilledValue(result, `confirm order ${index + 1}`);
  }

  const activeReservations = await db.inventoryReservation.findMany({
    where: { batchId: reservationCatalog.batchId, state: ReservationState.ACTIVE },
  });
  const reservedTotal = activeReservations.reduce((sum, row) => sum + quantity(row.quantity), 0);
  assert.equal(reservedTotal, 10, "active reservations must equal on-hand, never exceed it");
  assert.ok(
    activeReservations.every((row) => quantity(row.quantity) <= 6),
    "no single order may reserve more than its 6-unit requirement",
  );

  const requirements = await db.orderMaterialRequirement.findMany({
    where: { orderItem: { orderId: { in: reservationOrderIds } } },
    include: { reservations: { where: { state: ReservationState.ACTIVE } } },
  });
  assert.equal(requirements.length, 3);
  let shortageTotal = 0;
  for (const requirement of requirements) {
    const reserved = requirement.reservations.reduce((sum, row) => sum + quantity(row.quantity), 0);
    assert.ok(reserved <= 6);
    shortageTotal += 6 - reserved;
  }
  assert.equal(shortageTotal, 8, "10 on hand against 18 requested leaves 8 as shortage");
  assert.equal(await balanceQty(reservationCatalog.batchId, warehouse.id), 10);

  const states = await db.order.findMany({
    where: { id: { in: reservationOrderIds } },
    select: { commercialState: true, supplyState: true },
  });
  assert.equal(states.filter((row) => row.supplyState === SupplyState.ON_HAND_COVERED).length, 1);
  assert.equal(states.filter((row) => row.supplyState === SupplyState.PURCHASE_REQUIRED).length, 2);
  console.log("release-concurrency reservation race: 10 reserved of 18 requested, 8 shortage");

  // 2) Two reports of 7 units against the same 10-unit batch. Only one can commit; the loser must
  // leave no LossRecord, movement or audit behind, and the balance must reconcile to one deduction.
  const lossRaceCatalog = await createCatalog("loss-race", 10, 1);
  const lossRaceInputs: RecordLossInput[] = [1, 2].map((index) => ({
    batchId: lossRaceCatalog.batchId,
    locationId: warehouse.id,
    quantity: 7,
    reason: LossReason.CARE_DAMAGE,
    note: `并发报损 ${index}`,
    idempotencyKey: `loss-race-${marker}-${index}`,
  }));
  const lossRaceResults = await Promise.allSettled(lossRaceInputs.map((input, index) =>
    withDeadline(db.$transaction((tx) => recordLoss(tx, scope, input)), `loss race ${index + 1}`)));
  const lossWinners = lossRaceResults.filter((result) => result.status === "fulfilled");
  const lossLosers = lossRaceResults.filter((result) => result.status === "rejected");
  assert.equal(lossWinners.length, 1, "exactly one 7-unit loss may commit from 10 on hand");
  assert.equal(lossLosers.length, 1);
  assert.match(
    String((lossLosers[0] as PromiseRejectedResult).reason),
    /可用库存/,
    "the losing loss must fail on the rechecked availability, not on a raw database error",
  );
  assert.equal(await balanceQty(lossRaceCatalog.batchId, warehouse.id), 3);
  const lossRaceRecords = await db.lossRecord.findMany({ where: { batchId: lossRaceCatalog.batchId } });
  assert.equal(lossRaceRecords.length, 1);
  const lossRaceMovements = await db.inventoryTransaction.findMany({
    where: { batchId: lossRaceCatalog.batchId },
  });
  assert.equal(lossRaceMovements.length, 1);
  assert.equal(lossRaceMovements[0].kind, TransactionKind.LOSS);
  assert.equal(quantity(lossRaceMovements[0].quantity), 7);
  assert.equal(lossRaceMovements[0].referenceId, lossRaceRecords[0].id);
  assert.equal(await db.auditEvent.count({
    where: { entityId: lossRaceRecords[0].id, action: "LOSS_RECORDED" },
  }), 1);
  console.log("release-concurrency loss race: one deduction, loser rolled back, balance 3");

  // 3) Three concurrent submissions with the same idempotency key. The first writes; the other two
  // return the same LossRecord and movement without decrementing the balance again.
  const idempotentCatalog = await createCatalog("loss-idempotent", 10, 1);
  const idempotencyKey = `loss-idem-${marker}-${crypto.randomUUID()}`;
  const idempotentInput: RecordLossInput = {
    batchId: idempotentCatalog.batchId,
    locationId: warehouse.id,
    quantity: 3,
    reason: LossReason.EXPIRED,
    note: "重复提交",
    idempotencyKey,
  };
  const idempotentResults = await Promise.allSettled([1, 2, 3].map((index) =>
    withDeadline(
      db.$transaction((tx) => recordLoss(tx, scope, idempotentInput)),
      `idempotent loss ${index}`,
    )));
  const idempotentValues = idempotentResults.map((result, index) =>
    fulfilledValue(result, `idempotent loss ${index + 1}`));
  assert.equal(new Set(idempotentValues.map((row) => row.lossRecordId)).size, 1);
  assert.equal(new Set(idempotentValues.map((row) => row.transactionId)).size, 1);
  assert.equal(idempotentValues.filter((row) => row.idempotent).length, 2);
  assert.equal(idempotentValues.filter((row) => !row.idempotent).length, 1);
  assert.equal(await balanceQty(idempotentCatalog.batchId, warehouse.id), 7);
  assert.equal(await db.lossRecord.count({ where: { batchId: idempotentCatalog.batchId } }), 1);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: idempotentCatalog.batchId },
  }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: idempotentValues[0].lossRecordId, action: "LOSS_RECORDED" },
  }), 1);
  console.log("release-concurrency idempotency key: one write, two idempotent replays");

  // 4) Double-submitting production completion for one order. The order row lock serializes the
  // calls; the second sees COMPLETED and returns without a second transfer/consume or audit.
  const productionCatalog = await createCatalog("production", 10, 5);
  const productionOrderId = await createDraftOrder(productionCatalog);
  await confirmOrder(productionOrderId);
  const productionResults = await Promise.allSettled([1, 2].map((index) =>
    withDeadline(
      completeProduction(db, productionOrderId, tenantId!, storeId!),
      `production completion ${index}`,
    )));
  for (const [index, result] of productionResults.entries()) {
    fulfilledValue(result, `production completion ${index + 1}`);
  }
  assert.equal(await balanceQty(productionCatalog.batchId, warehouse.id), 5);
  const productionMovements = await db.inventoryTransaction.findMany({
    where: { batchId: productionCatalog.batchId },
  });
  const productionTransfers = productionMovements.filter((row) => row.kind === TransactionKind.TRANSFER);
  const productionConsumes = productionMovements.filter((row) => row.kind === TransactionKind.CONSUME);
  assert.equal(productionTransfers.length, 1);
  assert.equal(productionConsumes.length, 1);
  assert.equal(quantity(productionTransfers[0].quantity), 5);
  assert.equal(quantity(productionConsumes[0].quantity), 5);
  assert.equal(await db.materialUsage.count({
    where: { task: { orderItem: { orderId: productionOrderId } } },
  }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: productionOrderId, action: "PRODUCTION_COMPLETED" },
  }), 1);
  assert.equal(await db.inventoryReservation.count({
    where: {
      requirement: { orderItem: { orderId: productionOrderId } },
      state: ReservationState.CONSUMED,
    },
  }), 1);
  const completedOrder = await db.order.findUniqueOrThrow({ where: { id: productionOrderId } });
  assert.equal(completedOrder.productionState, ProductionState.COMPLETED);
  console.log("release-concurrency production double-submit: one deduction, one audit");

  // 5) Loss and production deduction race on the same batch. The confirmed order already holds a
  // 5-unit reservation, so only 5 units are free; a 6-unit loss must lose regardless of execution
  // order while production completes exactly once and leaves no partial loss rows.
  const mixedCatalog = await createCatalog("mixed", 10, 5);
  const mixedOrderId = await createDraftOrder(mixedCatalog);
  await confirmOrder(mixedOrderId);
  const mixedResults = await Promise.allSettled([
    withDeadline(db.$transaction((tx) => recordLoss(tx, scope, {
      batchId: mixedCatalog.batchId,
      locationId: warehouse.id,
      quantity: 6,
      reason: LossReason.CARE_DAMAGE,
      note: "与制作并发报损",
      idempotencyKey: `loss-mixed-${marker}`,
    })), "mixed loss"),
    withDeadline(
      completeProduction(db, mixedOrderId, tenantId!, storeId!),
      "mixed production completion",
    ),
  ]);
  assert.equal(mixedResults[0].status, "rejected", "6-unit loss cannot use stock reserved for the order");
  assert.equal(mixedResults[1].status, "fulfilled");
  assert.match(String((mixedResults[0] as PromiseRejectedResult).reason), /可用库存/);
  assert.equal(await balanceQty(mixedCatalog.batchId, warehouse.id), 5);
  assert.equal(await db.lossRecord.count({ where: { batchId: mixedCatalog.batchId } }), 0);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: mixedCatalog.batchId, kind: TransactionKind.LOSS },
  }), 0);
  const mixedProductionMovements = await db.inventoryTransaction.findMany({
    where: { batchId: mixedCatalog.batchId },
  });
  assert.equal(mixedProductionMovements.filter((row) => row.kind === TransactionKind.TRANSFER).length, 1);
  assert.equal(mixedProductionMovements.filter((row) => row.kind === TransactionKind.CONSUME).length, 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: mixedOrderId, action: "PRODUCTION_COMPLETED" },
  }), 1);
  console.log("release-concurrency loss vs production: reservation protects stock, loss rolls back");

  console.log("v2 release concurrency tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  const orderScope = { order: tenants };

  await db.auditEvent.deleteMany({ where: tenants });
  await db.lossRecord.deleteMany({ where: { OR: [{ order: tenants }, { store: tenants }] } });
  await db.costEntry.deleteMany({ where: orderScope });
  await db.materialUsage.deleteMany({ where: { task: { orderItem: orderScope } } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: orderScope } } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: orderScope } });
  await db.productionTask.deleteMany({ where: { orderItem: orderScope } });
  await db.fulfillment.deleteMany({ where: orderScope });
  await db.orderItem.deleteMany({ where: orderScope });
  await db.orderRevision.deleteMany({ where: orderScope });
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
      console.error("release-concurrency cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
