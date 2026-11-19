import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, FulfillmentKind, FulfillmentState, HoldState, LocationKind,
  MaterialKind, PaymentKind, PaymentState, PrismaClient, ProductionState, RecipeState,
  RefundState, ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { cancelOrder, closeOrder, startOrderProduction } from "./order-lifecycle";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for order-lifecycle tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let primaryTenantId: string | undefined;
let secondaryTenantId: string | undefined;
let mainStoreId: string | undefined;
let warehouseId: string | undefined;

const actorStaffId = `staff-${marker}`;

type Catalog = {
  materialId: string;
  batchId: string;
  skuId: string;
  versionId: string;
};

function loadOrder(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      items: {
        include: {
          requirements: { include: { reservations: true } },
          tasks: true,
        },
      },
      fulfillment: true,
      refunds: true,
    },
  });
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

function activeReservations(orderId: string) {
  return db.inventoryReservation.findMany({
    where: {
      requirement: { orderItem: { orderId } },
      state: ReservationState.ACTIVE,
    },
    orderBy: { id: "asc" },
  });
}

function cancellationAudits(orderId: string) {
  return db.auditEvent.findMany({
    where: { entityType: "Order", entityId: orderId, action: "ORDER_CANCELLED" },
    orderBy: { occurredAt: "asc" },
  });
}

function closeAudits(orderId: string) {
  return db.auditEvent.findMany({
    where: { entityType: "Order", entityId: orderId, action: "ORDER_CLOSED" },
    orderBy: { occurredAt: "asc" },
  });
}

function productionStartAudits(orderId: string) {
  return db.auditEvent.findMany({
    where: { entityType: "Order", entityId: orderId, action: "ORDER_PRODUCTION_STARTED" },
    orderBy: { occurredAt: "asc" },
  });
}

function jsonObject(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function activeTotal(order: LoadedOrder): number {
  return order.items
    .flatMap((item) => item.requirements)
    .flatMap((requirement) => requirement.reservations)
    .filter((reservation) => reservation.state === ReservationState.ACTIVE)
    .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);
}

async function createCatalog(
  label: string,
  onHand: number,
  perUnitQuantity: number,
): Promise<Catalog> {
  assert.ok(primaryTenantId && mainStoreId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
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
  return { materialId: material.id, batchId: batch.id, skuId: sku.id, versionId: version.id };
}

async function createDraftOrder(catalog: Catalog, quantity = 1): Promise<string> {
  assert.ok(primaryTenantId && mainStoreId);
  return createManualOrder(db, {
    tenantId: primaryTenantId,
    storeId: mainStoreId,
    skuId: catalog.skuId,
    quantity,
    deliveryAt: futureDate(3),
    buyerName: "订单生命周期测试",
    fulfillmentKind: "PICKUP",
  });
}

async function confirmOrder(orderId: string): Promise<void> {
  assert.ok(primaryTenantId && mainStoreId);
  assert.deepEqual(await confirmManualOrder(db, orderId, primaryTenantId, mainStoreId), {
    covered: true, totalShortage: 0,
  });
}

async function createActiveHold(orderId: string, skuId: string): Promise<string> {
  const hold = await db.availabilityHold.create({
    data: {
      orderId,
      skuId,
      quantity: 1,
      expiresAt: futureDate(1),
      state: HoldState.ACTIVE,
    },
  });
  return hold.id;
}

async function createRequestedRefund(orderId: string): Promise<string> {
  const payment = await db.paymentTransaction.create({
    data: {
      orderId,
      method: PaymentKind.CASH,
      state: PaymentState.SUCCEEDED,
      amount: 99,
      idempotencyKey: `pay-${marker}-${crypto.randomUUID()}`,
    },
  });
  const refund = await db.refundTransaction.create({
    data: {
      orderId,
      paymentId: payment.id,
      state: RefundState.REQUESTED,
      amount: 10,
      reason: "生命周期测试退款",
      idempotencyKey: `refund-${marker}-${crypto.randomUUID()}`,
    },
  });
  return refund.id;
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `lifecycle-primary-${marker}`, name: "订单生命周期主租户" },
  });
  primaryTenantId = tenant.id;
  const secondaryTenant = await db.tenant.create({
    data: { slug: `lifecycle-secondary-${marker}`, name: "订单生命周期其他租户" },
  });
  secondaryTenantId = secondaryTenant.id;
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: "MAIN", name: "订单生命周期主店" },
  });
  mainStoreId = store.id;
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: "OTHER", name: "订单生命周期他店" },
  });
  const warehouse = await db.inventoryLocation.create({
    data: { storeId: store.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId: store.id, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  // Confirmed order cancellation releases only its own active reservation and hold, writes one
  // audit event, and a replay neither releases nor audits again.
  const cancelCatalog = await createCatalog("cancel", 100, 5);
  const cancelledOrderId = await createDraftOrder(cancelCatalog, 1);
  await confirmOrder(cancelledOrderId);
  const keptOrderId = await createDraftOrder(cancelCatalog, 1);
  await confirmOrder(keptOrderId);

  const cancelledBefore = await loadOrder(cancelledOrderId);
  assert.equal(cancelledBefore.commercialState, CommercialState.CONFIRMED);
  assert.equal(activeTotal(cancelledBefore), 5);
  const ownActiveBefore = await activeReservations(cancelledOrderId);
  assert.equal(ownActiveBefore.length, 1);
  const otherActiveBefore = await activeReservations(keptOrderId);
  assert.equal(otherActiveBefore.length, 1);
  const holdId = await createActiveHold(cancelledOrderId, cancelCatalog.skuId);
  assert.equal((await db.availabilityHold.findUniqueOrThrow({ where: { id: holdId } })).state, HoldState.ACTIVE);

  const cancelResult = await cancelOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: cancelledOrderId,
    actorStaffId,
    reason: "顾客取消",
  });
  assert.deepEqual(cancelResult, {
    orderId: cancelledOrderId,
    cancelled: true,
    alreadyCancelled: false,
    releasedHoldCount: 1,
    releasedReservationCount: ownActiveBefore.length,
  });

  const cancelledAfter = await loadOrder(cancelledOrderId);
  assert.equal(cancelledAfter.commercialState, CommercialState.CANCELLED);
  assert.equal(activeTotal(cancelledAfter), 0);
  assert.equal(
    (await db.availabilityHold.findUniqueOrThrow({ where: { id: holdId } })).state,
    HoldState.RELEASED,
  );
  const otherActiveAfter = await activeReservations(keptOrderId);
  assert.deepEqual(
    otherActiveAfter.map((reservation) => reservation.id).sort(),
    otherActiveBefore.map((reservation) => reservation.id).sort(),
  );
  assert.equal(
    Number((await db.batchBalance.findFirstOrThrow({ where: { batchId: cancelCatalog.batchId } })).onHandQty),
    100,
  );

  const audits = await cancellationAudits(cancelledOrderId);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].entityType, "Order");
  assert.equal(audits[0].actorStaffId, actorStaffId);
  assert.equal(jsonObject(audits[0].beforeSnapshot).commercialState, CommercialState.CONFIRMED);
  const cancelAfterSnapshot = jsonObject(audits[0].afterSnapshot);
  assert.equal(cancelAfterSnapshot.commercialState, CommercialState.CANCELLED);
  assert.equal(cancelAfterSnapshot.reason, "顾客取消");
  assert.equal(cancelAfterSnapshot.releasedHoldCount, 1);
  assert.equal(cancelAfterSnapshot.releasedReservationCount, ownActiveBefore.length);

  const repeatedCancel = await cancelOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: cancelledOrderId,
    actorStaffId,
    reason: "重复取消",
  });
  assert.deepEqual(repeatedCancel, {
    orderId: cancelledOrderId,
    cancelled: false,
    alreadyCancelled: true,
    releasedHoldCount: 0,
    releasedReservationCount: 0,
  });
  assert.equal((await cancellationAudits(cancelledOrderId)).length, 1);
  assert.equal(
    (await db.availabilityHold.findUniqueOrThrow({ where: { id: holdId } })).state,
    HoldState.RELEASED,
  );
  console.log("order-lifecycle cancellation release, audit and idempotency passed");

  // Production that already started blocks cancellation and leaves its reservations untouched.
  const startedCatalog = await createCatalog("started", 50, 5);
  const startedOrderId = await createDraftOrder(startedCatalog, 1);
  await confirmOrder(startedOrderId);
  const tasksBeforeStart = await db.productionTask.findMany({
    where: { orderItem: { orderId: startedOrderId } },
  });
  assert.ok(tasksBeforeStart.length > 0);
  assert.ok(tasksBeforeStart.every((task) =>
    task.assigneeId === null && task.state === ProductionState.READY));
  const started = await startOrderProduction(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: startedOrderId,
    actorStaffId,
  });
  assert.deepEqual(started, {
    orderId: startedOrderId, started: true, alreadyStarted: false,
  });
  await assert.rejects(cancelOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: startedOrderId,
    actorStaffId,
    reason: "已开始制作后取消",
  }), /已开始制作/);
  const startedAfter = await loadOrder(startedOrderId);
  assert.equal(startedAfter.productionState, ProductionState.IN_PROGRESS);
  assert.equal(startedAfter.commercialState, CommercialState.CONFIRMED);
  assert.equal(activeTotal(startedAfter), 5);
  console.log("order-lifecycle started production cancellation guard passed");

  // A requested refund blocks cancellation.
  const refundCatalog = await createCatalog("refund", 50, 5);
  const refundOrderId = await createDraftOrder(refundCatalog, 1);
  await confirmOrder(refundOrderId);
  await createRequestedRefund(refundOrderId);
  await assert.rejects(cancelOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: refundOrderId,
    actorStaffId,
    reason: "待退款订单取消",
  }), /未完成的退款/);
  const refundBlocked = await loadOrder(refundOrderId);
  assert.equal(refundBlocked.commercialState, CommercialState.CONFIRMED);
  assert.equal(activeTotal(refundBlocked), 5);
  console.log("order-lifecycle requested refund cancellation guard passed");

  // Cross-tenant and cross-store calls fail with the same non-disclosing error.
  const scopedCatalog = await createCatalog("scoped", 50, 5);
  const scopedOrderId = await createDraftOrder(scopedCatalog, 1);
  await confirmOrder(scopedOrderId);
  await assert.rejects(cancelOrder(db, {
    tenantId: secondaryTenant.id,
    storeId: store.id,
    orderId: scopedOrderId,
    actorStaffId,
  }), /订单不存在/);
  await assert.rejects(cancelOrder(db, {
    tenantId: tenant.id,
    storeId: otherStore.id,
    orderId: scopedOrderId,
    actorStaffId,
  }), /订单不存在/);
  await assert.rejects(closeOrder(db, {
    tenantId: secondaryTenant.id,
    storeId: store.id,
    orderId: scopedOrderId,
    actorStaffId,
  }), /订单不存在/);
  await assert.rejects(startOrderProduction(db, {
    tenantId: tenant.id,
    storeId: otherStore.id,
    orderId: scopedOrderId,
    actorStaffId,
  }), /订单不存在/);
  const scopedAfter = await loadOrder(scopedOrderId);
  assert.equal(scopedAfter.commercialState, CommercialState.CONFIRMED);
  assert.equal(activeTotal(scopedAfter), 5);
  assert.equal((await productionStartAudits(scopedOrderId)).length, 0);
  console.log("order-lifecycle tenant/store ownership guard passed");

  // Delivered pickup order can be closed; close keeps the snapshot and reservation history and is
  // idempotent. A requested refund blocks closing until it is settled.
  const deliveredCatalog = await createCatalog("delivered", 100, 5);
  const deliveredOrderId = await createDraftOrder(deliveredCatalog, 1);
  await confirmOrder(deliveredOrderId);
  await assert.rejects(closeOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: deliveredOrderId,
    actorStaffId,
  }), /已交付/);

  await completeProduction(db, deliveredOrderId, tenant.id, store.id);
  // Pickup handover fixture. This suite owns cancel/close/start behaviour, so it writes the
  // delivered facts (and the cost snapshot a handover produces) directly instead of depending on
  // the delivery-cost service.
  const pickupFulfillment = await db.fulfillment.findUniqueOrThrow({
    where: { orderId: deliveredOrderId },
  });
  assert.equal(pickupFulfillment.kind, FulfillmentKind.PICKUP);
  await db.$transaction([
    db.fulfillment.update({
      where: { id: pickupFulfillment.id },
      data: { handedOverAt: new Date(), handedOverById: actorStaffId },
    }),
    db.order.update({
      where: { id: deliveredOrderId },
      data: { fulfillmentState: FulfillmentState.DELIVERED },
    }),
  ]);
  const delivered = await loadOrder(deliveredOrderId);
  assert.equal(delivered.fulfillmentState, FulfillmentState.DELIVERED);
  assert.ok(delivered.fulfillment?.handedOverAt);
  const consumedBeforeClose = await db.inventoryReservation.count({
    where: {
      requirement: { orderItem: { orderId: deliveredOrderId } },
      state: ReservationState.CONSUMED,
    },
  });
  assert.ok(consumedBeforeClose > 0);
  const snapshotBeforeClose = await db.orderCostSnapshot.create({
    data: {
      orderId: deliveredOrderId,
      revisionNo: 1,
      revenue: 99,
      materialCost: 10,
      packagingCost: 0,
      consumableCost: 1,
      laborCost: 2,
      deliveryCost: 0,
      platformCost: 0,
      attributedLossCost: 0,
      estimated: false,
    },
  });
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: deliveredOrderId } }), 1);

  const blockingRefundId = await createRequestedRefund(deliveredOrderId);
  await assert.rejects(closeOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: deliveredOrderId,
    actorStaffId,
  }), /未完成的退款/);
  await db.refundTransaction.update({
    where: { id: blockingRefundId },
    data: { state: RefundState.FAILED },
  });

  const closeResult = await closeOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: deliveredOrderId,
    actorStaffId,
    reason: "交付完成关单",
  });
  assert.deepEqual(closeResult, {
    orderId: deliveredOrderId, closed: true, alreadyClosed: false,
  });
  const closed = await loadOrder(deliveredOrderId);
  assert.equal(closed.commercialState, CommercialState.CLOSED);
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: deliveredOrderId } }), 1);
  const snapshotAfterClose = await db.orderCostSnapshot.findUniqueOrThrow({
    where: { id: snapshotBeforeClose.id },
  });
  assert.equal(Number(snapshotAfterClose.materialCost), Number(snapshotBeforeClose.materialCost));
  assert.equal(snapshotAfterClose.closedAt.getTime(), snapshotBeforeClose.closedAt.getTime());
  assert.equal(
    await db.inventoryReservation.count({
      where: {
        requirement: { orderItem: { orderId: deliveredOrderId } },
        state: ReservationState.CONSUMED,
      },
    }),
    consumedBeforeClose,
  );
  assert.equal(await activeReservations(deliveredOrderId).then((rows) => rows.length), 0);

  const closedAudits = await closeAudits(deliveredOrderId);
  assert.equal(closedAudits.length, 1);
  assert.equal(closedAudits[0].actorStaffId, actorStaffId);
  const closedSnapshot = jsonObject(closedAudits[0].afterSnapshot);
  assert.equal(closedSnapshot.commercialState, CommercialState.CLOSED);
  assert.equal(closedSnapshot.reason, "交付完成关单");

  const repeatedClose = await closeOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: deliveredOrderId,
    actorStaffId,
    reason: "重复关单",
  });
  assert.deepEqual(repeatedClose, {
    orderId: deliveredOrderId, closed: false, alreadyClosed: true,
  });
  assert.equal((await closeAudits(deliveredOrderId)).length, 1);
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: deliveredOrderId } }), 1);
  console.log("order-lifecycle delivered close, refund guard and idempotency passed");

  // Starting production must not require an assignee, moves every READY task, and is idempotent.
  const productionCatalog = await createCatalog("production", 50, 5);
  const productionOrderId = await createDraftOrder(productionCatalog, 1);
  await confirmOrder(productionOrderId);
  const readyTasks = await db.productionTask.findMany({
    where: { orderItem: { orderId: productionOrderId } },
    orderBy: { id: "asc" },
  });
  assert.ok(readyTasks.length > 0);
  assert.ok(readyTasks.every((task) =>
    task.assigneeId === null && task.state === ProductionState.READY));

  const startResult = await startOrderProduction(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: productionOrderId,
    actorStaffId,
  });
  assert.deepEqual(startResult, {
    orderId: productionOrderId, started: true, alreadyStarted: false,
  });
  const productionAfter = await loadOrder(productionOrderId);
  assert.equal(productionAfter.commercialState, CommercialState.CONFIRMED);
  assert.equal(productionAfter.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(productionAfter.productionState, ProductionState.IN_PROGRESS);
  const startedTasks = productionAfter.items.flatMap((item) => item.tasks);
  assert.equal(startedTasks.length, readyTasks.length);
  assert.ok(startedTasks.every((task) =>
    task.state === ProductionState.IN_PROGRESS && task.startedAt !== null));

  const productionAudits = await productionStartAudits(productionOrderId);
  assert.equal(productionAudits.length, 1);
  const productionAfterSnapshot = jsonObject(productionAudits[0].afterSnapshot);
  assert.equal(productionAfterSnapshot.productionState, ProductionState.IN_PROGRESS);
  assert.equal(productionAfterSnapshot.startedTaskCount, readyTasks.length);

  const firstStartedAt = startedTasks[0].startedAt?.getTime();
  const repeatedStart = await startOrderProduction(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: productionOrderId,
    actorStaffId,
  });
  assert.deepEqual(repeatedStart, {
    orderId: productionOrderId, started: false, alreadyStarted: true,
  });
  assert.equal((await productionStartAudits(productionOrderId)).length, 1);
  const repeatedTasks = await db.productionTask.findMany({
    where: { orderItem: { orderId: productionOrderId } },
  });
  assert.ok(repeatedTasks.every((task) =>
    task.state === ProductionState.IN_PROGRESS
    && task.startedAt?.getTime() === firstStartedAt));

  const draftCatalog = await createCatalog("draft", 50, 5);
  const draftOrderId = await createDraftOrder(draftCatalog, 1);
  await assert.rejects(startOrderProduction(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: draftOrderId,
    actorStaffId,
  }), /尚未确认/);
  console.log("order-lifecycle production start, assignee-free start and idempotency passed");

  console.log("v2 order lifecycle tests passed");
}

async function cleanup() {
  const tenantIds = [primaryTenantId, secondaryTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  const orderScope = { order: tenants };

  await db.auditEvent.deleteMany({ where: tenants });
  await db.availabilityHoldMaterial.deleteMany({ where: { hold: orderScope } });
  await db.availabilityHold.deleteMany({ where: orderScope });
  await db.refundTransaction.deleteMany({ where: orderScope });
  await db.paymentTransaction.deleteMany({ where: orderScope });
  await db.costAdjustment.deleteMany({ where: orderScope });
  await db.orderCostSnapshot.deleteMany({ where: orderScope });
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
      console.error("order-lifecycle cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
