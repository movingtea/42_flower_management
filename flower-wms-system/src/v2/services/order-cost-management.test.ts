import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, CostKind, CostStage, LocationKind, MaterialKind,
  Prisma, PrismaClient, RecipeState,
} from "../../generated/prisma-v2-draft/client";
import { completeDelivery } from "./complete-delivery";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { createDeliveryAttempt, startDeliveryAttempt } from "./delivery-management";
import { calculateOrderCostBreakdown, recordDeliveryActualCost } from "./order-cost-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for order cost tests");
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
    buyerName: "成本测试",
    fulfillmentKind,
    recipientName: fulfillmentKind === "DELIVERY" ? "收花人" : undefined,
    recipientPhone: fulfillmentKind === "DELIVERY" ? "13800000000" : undefined,
    address: fulfillmentKind === "DELIVERY" ? "测试路 1 号" : undefined,
    deliveryFee: fulfillmentKind === "DELIVERY" ? 10 : 0,
    estimatedDeliveryCost: fulfillmentKind === "DELIVERY" ? 8 : undefined,
  });
}

async function prepareOrder(catalog: Catalog, fulfillmentKind: "PICKUP" | "DELIVERY"): Promise<string> {
  assert.ok(tenantId && storeId);
  const orderId = await createOrder(catalog, fulfillmentKind);
  assert.deepEqual(await confirmManualOrder(db, orderId, tenantId, storeId), {
    covered: true, totalShortage: 0,
  });
  await completeProduction(db, orderId, tenantId, storeId);
  return orderId;
}

function testPureBreakdown() {
  const empty = calculateOrderCostBreakdown({
    items: [{
      quantity: 2, unitPrice: "100.00",
      estimatedConsumableCostSnapshot: 0, estimatedLaborCostSnapshot: 0,
    }],
    fulfillment: {
      kind: "PICKUP", deliveryFeeCharged: 0, deliveryCostActual: null, deliveryCostEstimated: null,
    },
    entries: [],
  });
  assert.equal(empty.revenue, 200);
  assert.equal(empty.totalCost, 0);
  assert.equal(empty.grossProfit, 200);
  assert.equal(empty.grossMargin, 1);
  assert.equal(empty.deliveryCost, 0);
  assert.equal(empty.estimated, true);
  assert.deepEqual(empty.missingKinds, [
    "MATERIAL", "PACKAGING", "CONSUMABLE", "LABOR", "PLATFORM", "LOSS",
  ]);

  const withEntries = calculateOrderCostBreakdown({
    items: [{
      quantity: 1, unitPrice: "99.90",
      estimatedConsumableCostSnapshot: 0, estimatedLaborCostSnapshot: 0,
    }],
    fulfillment: {
      kind: "DELIVERY", deliveryFeeCharged: "10.10",
      deliveryCostActual: 999, deliveryCostEstimated: 888,
    },
    entries: [
      { kind: "MATERIAL", stage: "ACTUAL", amount: "10.00", estimated: false },
      { kind: "PACKAGING", stage: "ACTUAL", amount: "5.55", estimated: true },
      { kind: "DELIVERY", stage: "ACTUAL", amount: "12.34", estimated: false },
      { kind: "MATERIAL", stage: "PLANNED", amount: "500", estimated: false },
      { kind: "LABOR", stage: "STANDARD", amount: "500", estimated: false },
    ],
  });
  assert.equal(withEntries.revenue, 110);
  assert.equal(withEntries.materialCost, 10);
  assert.equal(withEntries.packagingCost, 5.55);
  assert.equal(withEntries.deliveryCost, 12.34, "the actual entry wins and is never added twice");
  assert.equal(withEntries.totalCost, 27.89);
  assert.equal(withEntries.grossProfit, 82.11);
  assert.equal(withEntries.estimated, true);
  assert.deepEqual(withEntries.missingKinds, ["CONSUMABLE", "LABOR", "PLATFORM", "LOSS"]);

  const deliveryActualFallback = calculateOrderCostBreakdown({
    items: [],
    fulfillment: {
      kind: "DELIVERY", deliveryFeeCharged: 0,
      deliveryCostActual: "20.00", deliveryCostEstimated: "30.00",
    },
    entries: [],
  });
  assert.equal(deliveryActualFallback.deliveryCost, 20);
  assert.equal(deliveryActualFallback.missingKinds.includes("DELIVERY"), false);

  const deliveryEstimateFallback = calculateOrderCostBreakdown({
    items: [],
    fulfillment: {
      kind: "DELIVERY", deliveryFeeCharged: 0,
      deliveryCostActual: null, deliveryCostEstimated: "30.00",
    },
    entries: [],
  });
  assert.equal(deliveryEstimateFallback.deliveryCost, 30);
  assert.equal(deliveryEstimateFallback.estimated, true);

  const deliveryMissing = calculateOrderCostBreakdown({
    items: [],
    fulfillment: {
      kind: "DELIVERY", deliveryFeeCharged: 0,
      deliveryCostActual: null, deliveryCostEstimated: null,
    },
    entries: [],
  });
  assert.equal(deliveryMissing.deliveryCost, 0);
  assert.equal(deliveryMissing.missingKinds.includes("DELIVERY"), true);

  // Database rows pass Prisma Decimal objects, not plain numbers/strings.
  const decimalBreakdown = calculateOrderCostBreakdown({
    items: [{
      quantity: 1,
      unitPrice: new Prisma.Decimal("20.00"),
      estimatedConsumableCostSnapshot: new Prisma.Decimal("1.00"),
      estimatedLaborCostSnapshot: new Prisma.Decimal("2.00"),
    }],
    fulfillment: {
      kind: "DELIVERY",
      deliveryFeeCharged: new Prisma.Decimal("5.00"),
      deliveryCostActual: new Prisma.Decimal("6.00"),
      deliveryCostEstimated: new Prisma.Decimal("4.00"),
    },
    entries: [{
      kind: "MATERIAL", stage: "ACTUAL",
      amount: new Prisma.Decimal("3.00"), estimated: false,
    }],
  });
  assert.equal(decimalBreakdown.revenue, 25);
  assert.equal(decimalBreakdown.materialCost, 3);
  assert.equal(decimalBreakdown.deliveryCost, 6);
  assert.equal(decimalBreakdown.totalCost, 9);
  assert.equal(decimalBreakdown.grossProfit, 16);
}

async function main() {
  testPureBreakdown();

  const tenant = await db.tenant.create({
    data: { slug: `phase1-order-cost-${marker}`, name: "Phase 1 订单成本测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 订单成本测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  const catalog = await createCatalog("delivery-cost");
  const orderId = await prepareOrder(catalog, "DELIVERY");
  const attempt = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost",
  });
  await startDeliveryAttempt(db, {
    tenantId, storeId, orderId, attemptId: attempt.attemptId, actorStaffId: "staff-cost",
  });

  const beforeClose = await recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost",
    attemptId: attempt.attemptId, amount: "12.34", note: "配送员报销",
  });
  assert.equal(beforeClose.orderId, orderId);
  assert.equal(beforeClose.attemptId, attempt.attemptId);
  assert.equal(beforeClose.amount, 12.34);
  assert.equal(beforeClose.note, "配送员报销");
  assert.equal(beforeClose.adjustmentId, null);
  assert.equal(beforeClose.snapshotRevisionNo, null);

  const attemptRow = await db.deliveryAttempt.findUniqueOrThrow({ where: { id: attempt.attemptId } });
  assert.equal(Number(attemptRow.deliveryCost), 12.34);
  let fulfillment = await db.fulfillment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(Number(fulfillment.deliveryCostActual), 12.34);
  let deliveryEntries = await db.costEntry.findMany({
    where: { orderId, kind: CostKind.DELIVERY, stage: CostStage.ACTUAL },
  });
  assert.equal(deliveryEntries.length, 1);
  assert.equal(Number(deliveryEntries[0].amount), 12.34);
  assert.equal(deliveryEntries[0].estimated, false);
  assert.equal(deliveryEntries[0].sourceType, "DELIVERY_ATTEMPT");
  assert.equal(deliveryEntries[0].sourceId, attempt.attemptId);

  const costAudit = await db.auditEvent.findFirst({
    where: { tenantId, action: "DELIVERY_COST_RECORDED", entityId: attempt.attemptId },
    orderBy: { occurredAt: "desc" },
  });
  assert.ok(costAudit);
  assert.equal((costAudit.afterSnapshot as { note?: string }).note, "配送员报销");

  await completeDelivery(db, orderId, tenantId, storeId, "staff-handover");
  const snapshot = await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId }, orderBy: { revisionNo: "desc" },
  });
  assert.equal(snapshot.revisionNo, 1);
  assert.equal(Number(snapshot.deliveryCost), 12.34);
  const originalDeliveryCost = Number(snapshot.deliveryCost);

  // A post-close correction appends a signed adjustment and never rewrites the snapshot.
  const afterClose = await recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost",
    attemptId: attempt.attemptId, amount: 15, note: "过路费补录",
  });
  assert.equal(afterClose.amount, 15);
  assert.ok(afterClose.adjustmentId);
  assert.equal(afterClose.snapshotRevisionNo, 1);
  const adjustment = await db.costAdjustment.findUniqueOrThrow({
    where: { id: afterClose.adjustmentId },
  });
  assert.equal(adjustment.orderId, orderId);
  assert.equal(adjustment.snapshotId, snapshot.id);
  assert.equal(adjustment.kind, CostKind.DELIVERY);
  assert.equal(Number(adjustment.amountDelta), 2.66);
  assert.equal(adjustment.reason, "过路费补录");
  assert.equal(adjustment.sourceType, "DELIVERY_ATTEMPT");
  assert.equal(adjustment.sourceId, attempt.attemptId);

  const snapshotAfter = await db.orderCostSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  assert.equal(Number(snapshotAfter.deliveryCost), originalDeliveryCost);
  assert.equal(snapshotAfter.closedAt.getTime(), snapshot.closedAt.getTime());
  fulfillment = await db.fulfillment.findUniqueOrThrow({ where: { orderId } });
  assert.equal(Number(fulfillment.deliveryCostActual), 15);
  deliveryEntries = await db.costEntry.findMany({
    where: { orderId, kind: CostKind.DELIVERY, stage: CostStage.ACTUAL },
  });
  assert.equal(deliveryEntries.length, 1, "the delivery entry is upserted in place");
  assert.equal(Number(deliveryEntries[0].amount), 15);

  // Replaying the same amount must not create another adjustment.
  const sameAmount = await recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost",
    attemptId: attempt.attemptId, amount: "15.00",
  });
  assert.equal(sameAmount.adjustmentId, null);
  assert.equal(await db.costAdjustment.count({ where: { orderId } }), 1);

  // Omitting attemptId selects the latest non-failed attempt (the delivered one).
  const latestAttempt = await recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost", amount: 16,
  });
  assert.equal(latestAttempt.attemptId, attempt.attemptId);
  assert.ok(latestAttempt.adjustmentId);
  assert.equal(await db.costAdjustment.count({ where: { orderId } }), 2);
  assert.equal(Number((await db.costAdjustment.findUniqueOrThrow({
    where: { id: latestAttempt.adjustmentId },
  })).amountDelta), 1);
  assert.equal(Number((await db.orderCostSnapshot.findUniqueOrThrow({
    where: { id: snapshot.id },
  })).deliveryCost), originalDeliveryCost);

  // Invalid input never mutates the stored delivery cost.
  const entriesBeforeInvalid = await db.costEntry.findMany({
    where: { orderId, kind: CostKind.DELIVERY, stage: CostStage.ACTUAL },
  });
  const adjustmentsBeforeInvalid = await db.costAdjustment.count({ where: { orderId } });
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost", amount: -1,
  }), /不能为负数/);
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost", amount: "1.234",
  }), /最多保留两位小数/);
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId: crypto.randomUUID(), storeId, orderId, actorStaffId: "staff-cost", amount: 20,
  }), /订单不存在/);
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId: crypto.randomUUID(), orderId, actorStaffId: "staff-cost", amount: 20,
  }), /订单不存在/);
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId, actorStaffId: "staff-cost",
    attemptId: crypto.randomUUID(), amount: 20,
  }), /配送尝试不存在/);
  assert.equal(Number((await db.fulfillment.findUniqueOrThrow({ where: { orderId } })).deliveryCostActual), 16);
  assert.equal((await db.costEntry.findMany({
    where: { orderId, kind: CostKind.DELIVERY, stage: CostStage.ACTUAL },
  })).length, entriesBeforeInvalid.length);
  assert.equal(await db.costAdjustment.count({ where: { orderId } }), adjustmentsBeforeInvalid);

  // Closing with only an estimated delivery cost and then recording the actual cost must adjust
  // only the difference, never add the estimate on top of the actual amount.
  const estimatedOrderId = await prepareOrder(await createCatalog("estimated-delivery"), "DELIVERY");
  const estimatedAttempt = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId: estimatedOrderId, actorStaffId: "staff-cost",
  });
  await startDeliveryAttempt(db, {
    tenantId, storeId, orderId: estimatedOrderId,
    attemptId: estimatedAttempt.attemptId, actorStaffId: "staff-cost",
  });
  await completeDelivery(db, estimatedOrderId, tenantId, storeId, "staff-handover");
  const estimatedSnapshot = await db.orderCostSnapshot.findFirstOrThrow({
    where: { orderId: estimatedOrderId }, orderBy: { revisionNo: "desc" },
  });
  assert.equal(Number(estimatedSnapshot.deliveryCost), 8);
  assert.equal(estimatedSnapshot.estimated, true);
  const estimateToActual = await recordDeliveryActualCost(db, {
    tenantId, storeId, orderId: estimatedOrderId, actorStaffId: "staff-cost",
    attemptId: estimatedAttempt.attemptId, amount: 10, note: "实际过路费",
  });
  assert.ok(estimateToActual.adjustmentId);
  const estimateAdjustment = await db.costAdjustment.findUniqueOrThrow({
    where: { id: estimateToActual.adjustmentId },
  });
  assert.equal(Number(estimateAdjustment.amountDelta), 2);
  assert.equal(Number((await db.orderCostSnapshot.findUniqueOrThrow({
    where: { id: estimatedSnapshot.id },
  })).deliveryCost), 8);
  assert.equal(Number((await db.fulfillment.findUniqueOrThrow({
    where: { orderId: estimatedOrderId },
  })).deliveryCostActual), 10);

  // Cancelled orders are terminal: late cost corrections are rejected.
  const cancelledOrderId = await prepareOrder(await createCatalog("cancelled-cost"), "DELIVERY");
  const cancelledAttempt = await createDeliveryAttempt(db, {
    tenantId, storeId, orderId: cancelledOrderId, actorStaffId: "staff-cost",
  });
  await db.order.update({
    where: { id: cancelledOrderId },
    data: { commercialState: CommercialState.CANCELLED },
  });
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId: cancelledOrderId, actorStaffId: "staff-cost",
    attemptId: cancelledAttempt.attemptId, amount: 10,
  }), /已取消订单/);
  assert.equal(await db.costEntry.count({
    where: { orderId: cancelledOrderId, kind: CostKind.DELIVERY },
  }), 0);
  assert.equal(Number((await db.fulfillment.findUniqueOrThrow({
    where: { orderId: cancelledOrderId },
  })).deliveryCostActual ?? 0), 0);

  // A delivery order without an attempt cannot record a cost.
  const noAttemptOrderId = await prepareOrder(await createCatalog("no-attempt"), "DELIVERY");
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId: noAttemptOrderId, actorStaffId: "staff-cost", amount: 10,
  }), /缺少配送尝试/);

  // Pickup orders have no delivery cost to record.
  const pickupOrderId = await prepareOrder(await createCatalog("pickup-cost"), "PICKUP");
  await assert.rejects(recordDeliveryActualCost(db, {
    tenantId, storeId, orderId: pickupOrderId, actorStaffId: "staff-cost", amount: 10,
  }), /仅配送订单/);

  console.log("v2 order-cost-management tests passed");
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
      console.error("order-cost-management cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
