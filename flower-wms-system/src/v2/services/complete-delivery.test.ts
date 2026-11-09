import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DeliveryAttemptState, FulfillmentKind, FulfillmentState, LocationKind,
  MaterialKind, PrismaClient, ProductionState, RecipeState,
} from "../../generated/prisma-v2/client";
import { completeDelivery } from "./complete-delivery";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { createDeliveryAttempt, startDeliveryAttempt } from "./delivery-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for delivery completion tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = { materialId: string; batchId: string; skuId: string; versionId: string };

async function createCatalog(label: string): Promise<Catalog> {
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
    data: { batchId: batch.id, locationId: warehouseId, onHandQty: 100 },
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

async function createOrder(catalog: Catalog, fulfillmentKind: "PICKUP" | "DELIVERY"): Promise<string> {
  assert.ok(tenantId && storeId);
  return createManualOrder(db, {
    tenantId,
    storeId,
    skuId: catalog.skuId,
    quantity: 1,
    deliveryAt: futureDate(3),
    buyerName: "交付完成测试",
    fulfillmentKind,
    recipientName: fulfillmentKind === "DELIVERY" ? "收花人" : undefined,
    recipientPhone: fulfillmentKind === "DELIVERY" ? "13800000000" : undefined,
    address: fulfillmentKind === "DELIVERY" ? "测试路 1 号" : undefined,
    deliveryFee: fulfillmentKind === "DELIVERY" ? 10 : 0,
    estimatedDeliveryCost: fulfillmentKind === "DELIVERY" ? 8 : undefined,
  });
}

async function preparedOrder(catalog: Catalog, fulfillmentKind: "PICKUP" | "DELIVERY"): Promise<string> {
  assert.ok(tenantId && storeId);
  const orderId = await createOrder(catalog, fulfillmentKind);
  assert.deepEqual(await confirmManualOrder(db, orderId, tenantId, storeId), {
    covered: true, totalShortage: 0,
  });
  await completeProduction(db, orderId, tenantId, storeId);
  return orderId;
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-complete-delivery-${marker}`, name: "Phase 1 交付完成测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 交付完成测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  // Pickup: complete directly, record the handover and make the replay a true no-op.
  const pickupOrderId = await preparedOrder(await createCatalog("pickup"), "PICKUP");
  assert.equal((await db.order.findUniqueOrThrow({
    where: { id: pickupOrderId },
  })).fulfillmentState, FulfillmentState.WAITING_PICKUP);

  await completeDelivery(db, pickupOrderId, tenantId, storeId, "staff-pickup");
  let pickupOrder = await db.order.findUniqueOrThrow({
    where: { id: pickupOrderId }, include: { fulfillment: true },
  });
  assert.equal(pickupOrder.fulfillmentState, FulfillmentState.DELIVERED);
  assert.equal(pickupOrder.fulfillment?.kind, FulfillmentKind.PICKUP);
  assert.ok(pickupOrder.fulfillment?.handedOverAt instanceof Date);
  assert.equal(pickupOrder.fulfillment?.handedOverById, "staff-pickup");
  const pickupSnapshots = await db.orderCostSnapshot.findMany({
    where: { orderId: pickupOrderId }, orderBy: { revisionNo: "asc" },
  });
  assert.equal(pickupSnapshots.length, 1);
  assert.equal(pickupSnapshots[0].revisionNo, 1);
  assert.equal(Number(pickupSnapshots[0].revenue), 99);
  assert.equal(Number(pickupSnapshots[0].deliveryCost), 0);
  assert.equal(Number(pickupSnapshots[0].materialCost), 10);
  assert.equal(Number(pickupSnapshots[0].consumableCost), 1);
  assert.equal(Number(pickupSnapshots[0].laborCost), 2);
  const pickupAudit = await db.auditEvent.findFirstOrThrow({
    where: { tenantId, action: "DELIVERY_COMPLETED", entityId: pickupOrderId },
  });
  assert.equal((pickupAudit.afterSnapshot as { method?: string }).method, FulfillmentKind.PICKUP);
  assert.equal((pickupAudit.afterSnapshot as { revisionNo?: number }).revisionNo, 1);

  const pickupHandedOverAt = pickupOrder.fulfillment?.handedOverAt?.getTime();
  await completeDelivery(db, pickupOrderId, tenantId, storeId, "staff-other");
  pickupOrder = await db.order.findUniqueOrThrow({
    where: { id: pickupOrderId }, include: { fulfillment: true },
  });
  assert.equal(pickupOrder.fulfillment?.handedOverAt?.getTime(), pickupHandedOverAt);
  assert.equal(pickupOrder.fulfillment?.handedOverById, "staff-pickup");
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: pickupOrderId } }), 1);

  // Delivery without a started attempt is rejected, even when an attempt is merely scheduled.
  const deliveryOrderId = await preparedOrder(await createCatalog("delivery"), "DELIVERY");
  await assert.rejects(
    completeDelivery(db, deliveryOrderId, tenantId, storeId, "staff-delivery"),
    /配送订单需先开始配送尝试/,
  );
  const attempt = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId: deliveryOrderId, actorStaffId: "staff-delivery",
  });
  await assert.rejects(
    completeDelivery(db, deliveryOrderId, tenantId, storeId, "staff-delivery"),
    /配送订单需先开始配送尝试/,
  );
  assert.equal((await db.order.findUniqueOrThrow({
    where: { id: deliveryOrderId },
  })).fulfillmentState, FulfillmentState.WAITING_DELIVERY);
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: deliveryOrderId } }), 0);

  // The attempt's own cost wins, and must appear exactly once in the snapshot.
  await db.deliveryAttempt.update({
    where: { id: attempt.attemptId }, data: { deliveryCost: "9.99" },
  });
  await startDeliveryAttempt(db, {
    tenantId, storeId, orderId: deliveryOrderId, attemptId: attempt.attemptId,
    actorStaffId: "staff-delivery",
  });
  await completeDelivery(db, deliveryOrderId, tenantId, storeId, "staff-delivery");
  const deliveryOrder = await db.order.findUniqueOrThrow({
    where: { id: deliveryOrderId }, include: { fulfillment: true },
  });
  assert.equal(deliveryOrder.fulfillmentState, FulfillmentState.DELIVERED);
  assert.ok(deliveryOrder.fulfillment?.handedOverAt instanceof Date);
  assert.equal(deliveryOrder.fulfillment?.handedOverById, "staff-delivery");
  const deliveryAttempt = await db.deliveryAttempt.findUniqueOrThrow({
    where: { id: attempt.attemptId },
  });
  assert.equal(deliveryAttempt.state, DeliveryAttemptState.DELIVERED);
  assert.ok(deliveryAttempt.completedAt instanceof Date);
  const deliverySnapshot = await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId: deliveryOrderId }, orderBy: { revisionNo: "desc" },
  });
  assert.equal(deliverySnapshot.revisionNo, 1);
  assert.equal(Number(deliverySnapshot.deliveryCost), 9.99);
  assert.equal(Number(deliverySnapshot.revenue), 109);
  assert.equal(Number(deliverySnapshot.deliveryCost), 9.99, "attempt cost is not double counted");

  // An existing revision is preserved and completion appends the next revision number.
  const revisionOrderId = await preparedOrder(await createCatalog("revision"), "DELIVERY");
  const revisionAttempt = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId: revisionOrderId, actorStaffId: "staff-delivery",
  });
  await startDeliveryAttempt(db, {
    tenantId, storeId, orderId: revisionOrderId, attemptId: revisionAttempt.attemptId,
    actorStaffId: "staff-delivery",
  });
  await db.fulfillment.update({
    where: { orderId: revisionOrderId },
    data: { deliveryCostActual: "7.77" },
  });
  const firstRevision = await db.orderCostSnapshot.create({
    data: {
      orderId: revisionOrderId,
      revisionNo: 1,
      revenue: 0,
      materialCost: 0,
      packagingCost: 0,
      consumableCost: 0,
      laborCost: 0,
      deliveryCost: 0,
      platformCost: 0,
      attributedLossCost: 0,
      estimated: true,
    },
  });
  await completeDelivery(db, revisionOrderId, tenantId, storeId, "staff-revision");
  const revisions = await db.orderCostSnapshot.findMany({
    where: { orderId: revisionOrderId }, orderBy: { revisionNo: "asc" },
  });
  assert.deepEqual(revisions.map((snapshot) => snapshot.revisionNo), [1, 2]);
  assert.equal(Number(revisions[0].deliveryCost), 0);
  assert.equal(revisions[0].id, firstRevision.id);
  assert.equal(Number(revisions[1].deliveryCost), 7.77);
  assert.equal(revisions[1].estimated, true);
  const revisionAudit = await db.auditEvent.findFirstOrThrow({
    where: { tenantId, action: "DELIVERY_COMPLETED", entityId: revisionOrderId },
  });
  assert.equal((revisionAudit.afterSnapshot as { revisionNo?: number }).revisionNo, 2);
  assert.equal((revisionAudit.afterSnapshot as { attemptNo?: number }).attemptNo, 1);

  // Cross-tenant completion never touches the order.
  const protectedOrderId = await preparedOrder(await createCatalog("protected"), "PICKUP");
  await assert.rejects(
    completeDelivery(db, protectedOrderId, crypto.randomUUID(), storeId, "staff-other"),
    /订单不存在/,
  );
  assert.equal((await db.order.findUniqueOrThrow({
    where: { id: protectedOrderId },
  })).fulfillmentState, FulfillmentState.WAITING_PICKUP);
  assert.equal(await db.orderCostSnapshot.count({ where: { orderId: protectedOrderId } }), 0);

  // Commercial/production gates are unchanged.
  const draftOrderId = await createOrder(await createCatalog("draft"), "PICKUP");
  await assert.rejects(
    completeDelivery(db, draftOrderId, tenantId, storeId, "staff-other"),
    /订单尚未完成制作或确认/,
  );
  assert.equal((await db.order.findUniqueOrThrow({
    where: { id: draftOrderId },
  })).productionState, ProductionState.NOT_SCHEDULED);

  console.log("v2 complete-delivery tests passed");
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
      console.error("complete-delivery cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
