import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, DeliveryAttemptState, FulfillmentKind, FulfillmentState,
  LocationKind, MaterialKind, PrismaClient, ProductionState, RecipeState,
} from "../../generated/prisma-v2/client";
import { completeDelivery } from "./complete-delivery";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import {
  createDeliveryAttempt, failDeliveryAttempt, rescheduleDeliveryAttempt, startDeliveryAttempt,
} from "./delivery-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for delivery tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = { materialId: string; batchId: string; skuId: string; versionId: string };

async function createCatalog(label: string, onHand = 100): Promise<Catalog> {
  assert.ok(tenantId && storeId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId, code: `MAT-${code}`, name: `${label} 花材`,
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId, materialId: material.id, batchNo: `BATCH-${code}`, unitCost: 2 },
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
      lines: { create: { materialId: material.id, plannedQty: 5 } },
    },
  });
  return { materialId: material.id, batchId: batch.id, skuId: sku.id, versionId: version.id };
}

async function createDeliveryOrder(catalog: Catalog): Promise<string> {
  assert.ok(tenantId && storeId);
  return createManualOrder(db, {
    tenantId,
    storeId,
    skuId: catalog.skuId,
    quantity: 1,
    deliveryAt: futureDate(3),
    buyerName: "配送流程测试",
    fulfillmentKind: "DELIVERY",
    recipientName: "收花人",
    recipientPhone: "13800000000",
    address: "测试路 1 号",
    deliveryFee: 10,
    estimatedDeliveryCost: 8,
  });
}

async function prepareDeliveryOrder(catalog: Catalog): Promise<string> {
  assert.ok(tenantId && storeId);
  const orderId = await createDeliveryOrder(catalog);
  assert.deepEqual(await confirmManualOrder(db, orderId, tenantId, storeId), {
    covered: true, totalShortage: 0,
  });
  await completeProduction(db, orderId, tenantId, storeId);
  return orderId;
}

async function loadAttempts(orderId: string) {
  return db.deliveryAttempt.findMany({
    where: { fulfillment: { orderId } },
    orderBy: { attemptNo: "asc" },
  });
}

async function audit(action: string, entityId: string) {
  return db.auditEvent.findFirst({
    where: { tenantId, action, entityId },
    orderBy: { occurredAt: "desc" },
  });
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-delivery-${marker}`, name: "Phase 1 配送测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 配送测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  const catalog = await createCatalog("delivery-flow");
  const orderId = await prepareDeliveryOrder(catalog);

  let order = await db.order.findUniqueOrThrow({
    where: { id: orderId }, include: { fulfillment: true },
  });
  assert.equal(order.productionState, ProductionState.COMPLETED);
  assert.equal(order.fulfillmentState, FulfillmentState.WAITING_DELIVERY);
  assert.equal(order.fulfillment?.kind, FulfillmentKind.DELIVERY);

  const firstScheduledAt = futureDate(1);
  const created = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-delivery",
    scheduledAt: firstScheduledAt, note: "首次配送",
  });
  assert.deepEqual(created, {
    orderId,
    attemptId: created.attemptId,
    attemptNo: 1,
    state: DeliveryAttemptState.SCHEDULED,
    rescheduled: false,
  });
  let attempts = await loadAttempts(orderId);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].state, DeliveryAttemptState.SCHEDULED);
  assert.equal(attempts[0].departedAt, null);
  assert.equal(attempts[0].completedAt, null);
  const createdAudit = await audit("DELIVERY_ATTEMPT_CREATED", created.attemptId);
  assert.ok(createdAudit);
  assert.equal((createdAudit.afterSnapshot as { note?: string }).note, "首次配送");
  let fulfillment = await db.fulfillment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(fulfillment.scheduledAt?.getTime(), firstScheduledAt.getTime());
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).fulfillmentState,
    FulfillmentState.WAITING_DELIVERY);

  // A second first attempt and a reschedule that skips the failure acknowledgement are rejected.
  await assert.rejects(createDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-delivery",
  }), /已有进行中的配送尝试/);
  await assert.rejects(rescheduleDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-delivery", scheduledAt: futureDate(2),
  }), /尚未确认失败/);
  assert.equal((await loadAttempts(orderId)).length, 1);

  const started = await startDeliveryAttempt(db, {
    tenantId, storeId, orderId, attemptId: created.attemptId, actorStaffId: "staff-delivery",
  });
  assert.equal(started.state, DeliveryAttemptState.OUT_FOR_DELIVERY);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).fulfillmentState,
    FulfillmentState.DELIVERING);
  attempts = await loadAttempts(orderId);
  assert.ok(attempts[0].departedAt instanceof Date);
  assert.ok(await audit("DELIVERY_ATTEMPT_STARTED", created.attemptId));

  await assert.rejects(failDeliveryAttempt(db, {
    tenantId, storeId, orderId, attemptId: created.attemptId,
    actorStaffId: "staff-delivery", reason: "   ",
  }), /失败原因不能为空/);
  const stillDelivering = await loadAttempts(orderId);
  assert.equal(stillDelivering.length, 1);
  assert.equal(stillDelivering[0].state, DeliveryAttemptState.OUT_FOR_DELIVERY);

  const failed = await failDeliveryAttempt(db, {
    tenantId, storeId, orderId, attemptId: created.attemptId,
    actorStaffId: "staff-delivery", reason: "客户不在家",
  });
  assert.equal(failed.state, DeliveryAttemptState.FAILED);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).fulfillmentState,
    FulfillmentState.FAILED);
  attempts = await loadAttempts(orderId);
  assert.equal(attempts.length, 1, "failure must not automatically create the next attempt");
  assert.equal(attempts[0].state, DeliveryAttemptState.FAILED);
  assert.ok(attempts[0].completedAt instanceof Date);
  assert.equal(attempts[0].failureReason, "客户不在家");
  assert.ok(await audit("DELIVERY_ATTEMPT_FAILED", created.attemptId));

  await assert.rejects(rescheduleDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-delivery", scheduledAt: new Date(Date.now() - 1_000),
  }), /必须晚于当前时间/);
  assert.equal((await loadAttempts(orderId)).length, 1);

  const secondScheduledAt = futureDate(2);
  const rescheduled = await rescheduleDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-delivery",
    scheduledAt: secondScheduledAt, note: "客户改约",
  });
  assert.equal(rescheduled.attemptNo, 2);
  assert.equal(rescheduled.state, DeliveryAttemptState.SCHEDULED);
  assert.equal(rescheduled.rescheduled, true);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).fulfillmentState,
    FulfillmentState.WAITING_DELIVERY);
  fulfillment = await db.fulfillment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(fulfillment.scheduledAt?.getTime(), secondScheduledAt.getTime());
  attempts = await loadAttempts(orderId);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].attemptNo, 2);
  assert.equal(attempts[1].state, DeliveryAttemptState.SCHEDULED);
  assert.equal(attempts[1].failureReason, null);
  assert.ok(await audit("DELIVERY_ATTEMPT_RESCHEDULED", rescheduled.attemptId));

  const secondStart = await startDeliveryAttempt(db, {
    tenantId, storeId, orderId, attemptId: rescheduled.attemptId, actorStaffId: "staff-delivery",
  });
  assert.equal(secondStart.state, DeliveryAttemptState.OUT_FOR_DELIVERY);

  await completeDelivery(db, orderId, tenantId, storeId, "staff-handover");
  order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { fulfillment: true } });
  assert.equal(order.fulfillmentState, FulfillmentState.DELIVERED);
  assert.ok(order.fulfillment?.handedOverAt instanceof Date);
  assert.equal(order.fulfillment?.handedOverById, "staff-handover");
  attempts = await loadAttempts(orderId);
  assert.deepEqual(attempts.map((attempt) => attempt.state), [
    DeliveryAttemptState.FAILED,
    DeliveryAttemptState.DELIVERED,
  ]);
  assert.ok(attempts[1].completedAt instanceof Date);
  assert.equal(attempts[0].failureReason, "客户不在家");
  assert.equal((await db.orderCostSnapshot.count({ where: { orderId } })), 1);
  const completedAudit = await audit("DELIVERY_COMPLETED", orderId);
  assert.ok(completedAudit);
  const completedSnapshot = completedAudit.afterSnapshot as {
    attemptNo?: number; revisionNo?: number; method?: string;
  };
  assert.equal(completedSnapshot.attemptNo, 2);
  assert.equal(completedSnapshot.revisionNo, 1);
  assert.equal(completedSnapshot.method, FulfillmentKind.DELIVERY);

  const handedOverAt = order.fulfillment?.handedOverAt?.getTime();
  const snapshotCount = await db.orderCostSnapshot.count({ where: { orderId } });
  await completeDelivery(db, orderId, tenantId, storeId, "staff-handover");
  const replay = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { fulfillment: true } });
  assert.equal(replay.fulfillment?.handedOverAt?.getTime(), handedOverAt);
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId } }), snapshotCount);
  assert.equal((await loadAttempts(orderId)).length, 2);

  // Cross-tenant and cross-store calls are indistinguishable from a missing order.
  await assert.rejects(createDeliveryAttempt(db, {
    tenantId: crypto.randomUUID(), storeId, orderId, actorStaffId: "staff-delivery",
  }), /订单不存在/);
  await assert.rejects(failDeliveryAttempt(db, {
    tenantId, storeId: crypto.randomUUID(), orderId, attemptId: rescheduled.attemptId,
    actorStaffId: "staff-delivery", reason: "错误门店",
  }), /订单不存在/);

  // Confirming cancellation/close states also blocks new attempts.
  const blockedOrderId = await prepareDeliveryOrder(await createCatalog("blocked-delivery"));
  await db.order.update({
    where: { id: blockedOrderId },
    data: { commercialState: CommercialState.CANCELLED },
  });
  await assert.rejects(createDeliveryAttempt(db, {
    tenantId, storeId, orderId: blockedOrderId, actorStaffId: "staff-delivery",
  }), /不能创建配送尝试/);

  console.log("v2 delivery-management tests passed");
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
  await db.deliveryAttempt.deleteMany({ where: { fulfillment: { order: tenants } } });
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
      console.error("delivery-management cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
