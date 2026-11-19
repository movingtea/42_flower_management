import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, CostKind, CostStage, FulfillmentKind, FulfillmentState, LocationKind,
  MaterialKind, PrismaClient, ProductionState, RecipeState,
  ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { completeDelivery } from "./complete-delivery";
import { createDeliveryAttempt, startDeliveryAttempt } from "./delivery-management";
import { completeProduction } from "./complete-production";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { reviseManualOrder } from "./revise-order";
import { substituteOrderMaterial } from "./substitute-order-material";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for multi-order tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let primaryTenantId: string | undefined;
let secondaryTenantId: string | undefined;
let mainStoreId: string | undefined;
let warehouseId: string | undefined;

type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

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

function activeReservationIds(order: LoadedOrder): string[] {
  return order.items
    .flatMap((item) => item.requirements)
    .flatMap((requirement) => requirement.reservations)
    .filter((reservation) => reservation.state === ReservationState.ACTIVE)
    .map((reservation) => reservation.id)
    .sort();
}

function latestRequirementsByItem(order: LoadedOrder, revisionId: string) {
  return new Map(order.items.map((item) => [
    item.id,
    item.requirements.filter((requirement) => requirement.revisionId === revisionId),
  ]));
}

async function createMaterial(
  tenantId: string,
  label: string,
  onHand?: number,
  unitCost = 2,
  quantityScale = 0,
) {
  assert.ok(mainStoreId && warehouseId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId, code: `MAT-${code}`, name: `${label} 物料`,
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale,
    },
  });
  if (onHand === undefined) return { materialId: material.id, batchId: undefined };
  const batch = await db.inventoryBatch.create({
    data: { storeId: mainStoreId, materialId: material.id, batchNo: `BATCH-${code}`, unitCost },
  });
  await db.batchBalance.create({
    data: { batchId: batch.id, locationId: warehouseId, onHandQty: onHand },
  });
  return { materialId: material.id, batchId: batch.id };
}

async function createSku(
  tenantId: string,
  label: string,
  price: number,
  lines: { materialId: string; qty: number }[],
  active = true,
) {
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const product = await db.product.create({
    data: { tenantId, code: `PROD-${code}`, name: `${label} 商品`, active: true },
  });
  const sku = await db.productSku.create({
    data: {
      productId: product.id, code: `SKU-${code}`, name: "标准款", price,
      estimatedConsumableCost: 1, estimatedLaborCost: 2, active,
    },
  });
  await db.product.update({ where: { id: product.id }, data: { defaultSkuId: sku.id } });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  const version = await db.recipeVersion.create({
    data: {
      recipeId: recipe.id, versionNo: 1, state: RecipeState.PUBLISHED, publishedAt: new Date(),
      lines: { create: lines.map((line) => ({ materialId: line.materialId, plannedQty: line.qty })) },
    },
  });
  return { skuId: sku.id, productId: product.id, versionId: version.id };
}

async function batchBalance(batchId: string): Promise<number> {
  const balance = await db.batchBalance.findFirstOrThrow({ where: { batchId } });
  return Number(balance.onHandQty);
}

async function orderGraphCounts(tenantId: string) {
  const [orders, items, revisions, fulfillments] = await Promise.all([
    db.order.count({ where: { tenantId } }),
    db.orderItem.count({ where: { order: { tenantId } } }),
    db.orderRevision.count({ where: { order: { tenantId } } }),
    db.fulfillment.count({ where: { order: { tenantId } } }),
  ]);
  return { orders, items, revisions, fulfillments };
}

async function assertNoProductionWrites(
  orderId: string,
  batchId: string,
  expectedOnHand: number,
  expectedActiveIds: string[],
): Promise<void> {
  const order = await loadOrder(orderId);
  assert.equal(order.productionState, ProductionState.READY);
  assert.ok(order.items.every((item) => item.tasks.every((task) => task.state === ProductionState.READY)));
  assert.equal(await batchBalance(batchId), expectedOnHand);
  assert.equal(await db.materialUsage.count({ where: { task: { orderItem: { orderId } } } }), 0);
  assert.equal(await db.costEntry.count({ where: { orderId } }), 0);
  assert.deepEqual(activeReservationIds(order), expectedActiveIds);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-multi-${marker}`, name: "多商品订单测试租户" },
  });
  primaryTenantId = tenant.id;
  const secondaryTenant = await db.tenant.create({
    data: { slug: `phase1-multi-foreign-${marker}`, name: "多商品订单其他租户" },
  });
  secondaryTenantId = secondaryTenant.id;
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: "MAIN", name: "多商品订单测试店" },
  });
  mainStoreId = store.id;
  const foreignStore = await db.store.create({
    data: { tenantId: secondaryTenant.id, code: "FOREIGN", name: "其他租户门店" },
  });
  const warehouse = await db.inventoryLocation.create({
    data: { storeId: store.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  await db.inventoryLocation.create({
    data: { storeId: store.id, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
  });

  const sharedMaterial = await createMaterial(tenant.id, "共享花材", 100, 2);
  const otherMaterial = await createMaterial(tenant.id, "配叶", 100, 3);
  assert.ok(sharedMaterial.batchId && otherMaterial.batchId);
  const skuA = await createSku(tenant.id, "玫瑰主花", 99, [
    { materialId: sharedMaterial.materialId, qty: 2 },
  ]);
  const skuB = await createSku(tenant.id, "混合花束", 149, [
    { materialId: sharedMaterial.materialId, qty: 3 },
    { materialId: otherMaterial.materialId, qty: 1 },
  ]);
  const inactiveSku = await createSku(tenant.id, "下架商品", 50, [
    { materialId: sharedMaterial.materialId, qty: 1 },
  ], false);
  const foreignMaterial = await createMaterial(secondaryTenant.id, "外租户花材", 10, 1);
  const foreignSku = await createSku(secondaryTenant.id, "外租户商品", 50, [
    { materialId: foreignMaterial.materialId, qty: 1 },
  ]);

  const orderCountBefore = await db.order.count({ where: { tenantId: tenant.id } });
  const deliveryAt = futureDate(3);

  // Multi-line creation snapshots each line independently and keeps the legacy one-line input.
  const orderId = await createManualOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    deliveryAt,
    buyerName: "多商品顾客",
    fulfillmentKind: "DELIVERY",
    recipientName: "收件人",
    recipientPhone: "13800000000",
    address: "测试路 1 号",
    deliveryFee: 12,
    estimatedDeliveryCost: 5,
    items: [
      { skuId: skuA.skuId, quantity: 2 },
      { skuId: skuB.skuId, quantity: 1 },
    ],
  });
  let order = await loadOrder(orderId);
  assert.equal(order.items.length, 2);
  const itemA = order.items.find((item) => item.skuId === skuA.skuId);
  const itemB = order.items.find((item) => item.skuId === skuB.skuId);
  assert.ok(itemA && itemB);
  assert.equal(itemA.quantity, 2);
  assert.equal(itemB.quantity, 1);
  assert.equal(itemA.recipeVersionId, skuA.versionId);
  assert.equal(itemB.recipeVersionId, skuB.versionId);
  assert.equal(Number(itemA.unitPrice), 99);
  assert.equal(Number(itemB.unitPrice), 149);
  assert.equal(itemA.nameSnapshot, "玫瑰主花 商品 / 标准款");
  assert.equal(order.revisions.length, 1);
  assert.equal(order.revisions[0].number, 1);
  assert.equal(order.fulfillment?.kind, FulfillmentKind.DELIVERY);
  assert.equal(Number(order.fulfillment?.deliveryFeeCharged), 12);
  assert.equal(order.commercialState, CommercialState.DRAFT);
  assert.equal(order.items.every((item) => item.tasks.length === 0), true);

  const legacyOrderId = await createManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, skuId: skuA.skuId, quantity: 1,
    deliveryAt, fulfillmentKind: "PICKUP",
  });
  const legacyOrder = await loadOrder(legacyOrderId);
  assert.equal(legacyOrder.items.length, 1);
  assert.equal(legacyOrder.items[0].quantity, 1);

  // Invalid line sets never leave a partial order behind.
  const invalidInputs: { input: Parameters<typeof createManualOrder>[1]; pattern: RegExp }[] = [
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }, { skuId: skuA.skuId, quantity: 2 }],
      },
      pattern: /重复选择/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: Array.from({ length: 21 }, () => ({ skuId: skuA.skuId, quantity: 1 })),
      },
      pattern: /最多/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 0 }],
      },
      pattern: /正整数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: inactiveSku.skuId, quantity: 1 }],
      },
      pattern: /未上架/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }, { skuId: foreignSku.skuId, quantity: 1 }],
      },
      pattern: /不属于当前门店/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: foreignStore.id, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /门店不存在/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: crypto.randomUUID(), deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /门店不存在/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: "", deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /门店不存在/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: undefined as unknown as string, deliveryAt, fulfillmentKind: "PICKUP",
        items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /门店不存在/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        deliveryFee: Number.NaN, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /配送费用必须为非负有限数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        deliveryFee: Number.POSITIVE_INFINITY, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /配送费用必须为非负有限数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        estimatedDeliveryCost: Number.NaN, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /预计配送成本必须为非负有限数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        estimatedDeliveryCost: Number.NEGATIVE_INFINITY, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /预计配送成本必须为非负有限数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        deliveryFee: -1, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /配送费用必须为非负有限数/,
    },
    {
      input: {
        tenantId: tenant.id, storeId: store.id, deliveryAt, fulfillmentKind: "PICKUP",
        estimatedDeliveryCost: -1, items: [{ skuId: skuA.skuId, quantity: 1 }],
      },
      pattern: /预计配送成本必须为非负有限数/,
    },
  ];
  const countsBeforeInvalid = await orderGraphCounts(tenant.id);
  for (const { input, pattern } of invalidInputs) {
    await assert.rejects(createManualOrder(db, input), pattern);
  }
  assert.deepEqual(await orderGraphCounts(tenant.id), countsBeforeInvalid);
  assert.equal(await db.order.count({ where: { tenantId: tenant.id } }), orderCountBefore + 2);
  assert.equal(await db.order.count({ where: { storeId: foreignStore.id } }), 0);
  console.log("multi-order creation validation passed");

  // Confirmation expands every line independently, and two lines may reserve the same batch.
  assert.deepEqual(await confirmManualOrder(db, orderId, tenant.id, store.id), {
    covered: true, totalShortage: 0,
  });
  order = await loadOrder(orderId);
  assert.equal(order.commercialState, CommercialState.CONFIRMED);
  assert.equal(order.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(order.productionState, ProductionState.READY);
  assert.equal(order.items.every((item) => item.tasks.length === 1), true);
  assert.equal(order.items.every((item) => item.tasks[0].state === ProductionState.READY), true);
  const confirmedRevision = order.revisions[0];
  const confirmedRequirements = latestRequirementsByItem(order, confirmedRevision.id);
  assert.equal(confirmedRequirements.get(itemA.id)?.length, 1);
  assert.equal(Number(confirmedRequirements.get(itemA.id)?.[0].plannedQty), 4);
  assert.equal(confirmedRequirements.get(itemB.id)?.length, 2);
  assert.equal(
    confirmedRequirements.get(itemB.id)?.reduce((sum, row) => sum + Number(row.plannedQty), 0),
    4,
  );
  const sharedReservationCountBefore = await db.inventoryReservation.count({
    where: { batchId: sharedMaterial.batchId, state: ReservationState.ACTIVE },
  });
  assert.equal(sharedReservationCountBefore, 2);
  console.log("multi-order confirmation and shared inventory passed");

  // Rollback probes leave the latest revision, quantities, tasks and reservations unchanged.
  const beforeRollback = await loadOrder(orderId);
  const rollbackActiveIds = activeReservationIds(beforeRollback);
  const rollbackRevisionCount = beforeRollback.revisions.length;
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: futureDate(4), items: [{ orderItemId: itemA.id, quantity: 5 }],
  }), /所有现有商品行/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: futureDate(4), items: [
      { orderItemId: itemA.id, quantity: 5 },
      { orderItemId: itemB.id, quantity: 2 },
      { orderItemId: itemB.id, quantity: 3 },
    ],
  }), /重复提交/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: futureDate(4), items: [
      { orderItemId: itemA.id, quantity: 5 },
      { orderItemId: "foreign-item", quantity: 2 },
    ],
  }), /不属于当前订单/);
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: futureDate(4), items: [
      { orderItemId: itemA.id, quantity: 5 },
      { orderItemId: itemB.id, quantity: 0 },
    ],
  }), /正整数/);

  const foreignRecipeMaterial = await db.material.create({
    data: {
      tenantId: secondaryTenant.id, code: `FOREIGN-${marker}`, name: "外租户配方物料",
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const foreignLine = await db.recipeLine.create({
    data: { versionId: skuA.versionId, materialId: foreignRecipeMaterial.id, plannedQty: 1 },
  });
  await assert.rejects(reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: futureDate(4), items: [
      { orderItemId: itemA.id, quantity: 5 },
      { orderItemId: itemB.id, quantity: 2 },
    ],
  }), /another tenant/);
  await db.recipeLine.delete({ where: { id: foreignLine.id } });

  const afterRollback = await loadOrder(orderId);
  assert.equal(afterRollback.revisions.length, rollbackRevisionCount);
  assert.equal(afterRollback.version, 1);
  assert.equal(afterRollback.items.find((item) => item.id === itemA.id)?.quantity, 2);
  assert.equal(afterRollback.items.find((item) => item.id === itemB.id)?.quantity, 1);
  assert.deepEqual(activeReservationIds(afterRollback), rollbackActiveIds);
  console.log("multi-order revision rollback passed");

  // Pre-production multi-line revision scales every line and releases only its previous holds.
  const revisionDelivery = futureDate(5);
  const revision = await reviseManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, orderId,
    deliveryAt: revisionDelivery,
    items: [
      { orderItemId: itemA.id, quantity: 3 },
      { orderItemId: itemB.id, quantity: 2 },
    ],
  });
  assert.equal(revision.covered, true);
  assert.equal(revision.revisionNumber, 2);
  order = await loadOrder(orderId);
  assert.equal(order.version, 2);
  assert.equal(order.deliveryAt?.getTime(), revisionDelivery.getTime());
  assert.equal(order.fulfillment?.scheduledAt?.getTime(), revisionDelivery.getTime());
  assert.equal(order.items.find((item) => item.id === itemA.id)?.quantity, 3);
  assert.equal(order.items.find((item) => item.id === itemB.id)?.quantity, 2);
  assert.equal(order.items.find((item) => item.id === itemA.id)?.tasks[0].quantity, 3);
  assert.equal(order.items.find((item) => item.id === itemB.id)?.tasks[0].quantity, 2);
  assert.equal(
    order.items.flatMap((item) => item.requirements)
      .filter((requirement) => requirement.revisionId === beforeRollback.revisions[0].id)
      .flatMap((requirement) => requirement.reservations)
      .every((reservation) => reservation.state === ReservationState.RELEASED),
    true,
  );
  const revisedRequirements = latestRequirementsByItem(order, revision.revisionId);
  assert.equal(Number(revisedRequirements.get(itemA.id)?.[0].plannedQty), 6);
  assert.deepEqual(
    revisedRequirements.get(itemB.id)?.map((row) => Number(row.plannedQty)).sort((a, b) => a - b),
    [2, 6],
  );
  console.log("multi-order pre-production revision passed");

  // Explicit usage must identify task + batch when a batch is shared across production tasks.
  const sharedBatchId = sharedMaterial.batchId;
  const otherBatchId = otherMaterial.batchId;
  const taskA = order.items.find((item) => item.id === itemA.id)!.tasks[0];
  const taskB = order.items.find((item) => item.id === itemB.id)!.tasks[0];
  const revisedActiveIds = activeReservationIds(order);
  const sharedOnHand = await batchBalance(sharedBatchId);

  const invalidUsage: { input: Parameters<typeof completeProduction>[4]; pattern: RegExp }[] = [
    {
      input: [{ batchId: sharedBatchId, usedQty: 12 }],
      pattern: /taskId/,
    },
    {
      input: [
        { taskId: taskA.id, batchId: sharedBatchId, usedQty: 6 },
      ],
      pattern: /全部登记/,
    },
    {
      input: [
        { taskId: taskA.id, batchId: sharedBatchId, usedQty: 6 },
        { taskId: taskA.id, batchId: sharedBatchId, usedQty: 6 },
        { taskId: taskB.id, batchId: sharedBatchId, usedQty: 6 },
        { taskId: taskB.id, batchId: otherBatchId, usedQty: 2 },
      ],
      pattern: /批次重复/,
    },
    {
      input: [
        { taskId: taskA.id, batchId: otherBatchId, usedQty: 2 },
        { taskId: taskB.id, batchId: sharedBatchId, usedQty: 6 },
        { taskId: taskB.id, batchId: otherBatchId, usedQty: 2 },
      ],
      pattern: /制作任务/,
    },
  ];
  for (const { input, pattern } of invalidUsage) {
    await assert.rejects(
      completeProduction(db, orderId, tenant.id, store.id, input),
      pattern,
    );
    await assertNoProductionWrites(orderId, sharedBatchId, sharedOnHand, revisedActiveIds);
  }

  await completeProduction(db, orderId, tenant.id, store.id, [
    { taskId: taskA.id, batchId: sharedBatchId, usedQty: 6 },
    { taskId: taskB.id, batchId: sharedBatchId, usedQty: 6 },
    { taskId: taskB.id, batchId: otherBatchId, usedQty: 2 },
  ]);
  assert.equal(await batchBalance(sharedBatchId), sharedOnHand - 12);
  assert.equal(await batchBalance(otherBatchId), 98);
  const usages = await db.materialUsage.findMany({
    where: { task: { orderItem: { orderId } } },
    include: { task: true },
    orderBy: { taskId: "asc" },
  });
  assert.equal(usages.length, 3);
  assert.equal(
    usages.filter((usage) => usage.taskId === taskA.id).reduce((sum, usage) => sum + Number(usage.usedQty), 0),
    6,
  );
  assert.equal(
    usages.filter((usage) => usage.taskId === taskB.id).reduce((sum, usage) => sum + Number(usage.usedQty), 0),
    8,
  );
  const reservations = await db.inventoryReservation.findMany({
    where: { requirement: { orderItem: { orderId }, revisionId: revision.revisionId } },
  });
  assert.equal(reservations.length, 3);
  assert.ok(reservations.every((reservation) => reservation.state === ReservationState.CONSUMED));
  const completedOrder = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(completedOrder.productionState, ProductionState.COMPLETED);
  assert.equal(completedOrder.fulfillmentState, FulfillmentState.WAITING_DELIVERY);
  console.log("multi-order shared batch actual usage passed");

  // Delivery snapshot keeps per-line revenue and per-task material costs.
  const delivery = { tenantId: tenant.id, storeId: store.id, orderId, actorStaffId: "staff-test" };
  const { attemptId } = await createDeliveryAttempt(db, delivery);
  await startDeliveryAttempt(db, { ...delivery, attemptId });
  await completeDelivery(db, orderId, tenant.id, store.id, "staff-test");
  const snapshot = await db.orderCostSnapshot.findFirstOrThrow({ where: { orderId } });
  assert.equal(Number(snapshot.revenue), 607);
  assert.equal(Number(snapshot.materialCost), 30);
  assert.equal(Number(snapshot.consumableCost), 5);
  assert.equal(Number(snapshot.laborCost), 10);
  assert.equal(Number(snapshot.deliveryCost), 5);
  const actualCosts = await db.costEntry.findMany({ where: { orderId, stage: CostStage.ACTUAL } });
  assert.equal(
    actualCosts.filter((entry) => entry.kind === CostKind.MATERIAL).reduce((sum, entry) => sum + Number(entry.amount), 0),
    30,
  );
  const delivered = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(delivered.fulfillmentState, FulfillmentState.DELIVERED);
  console.log("multi-order delivery snapshot passed");

  // Substitution survives a later multi-line quantity revision per item.
  const shortMaterial = await createMaterial(tenant.id, "缺货花材");
  const replacementMaterial = await createMaterial(tenant.id, "替代花材", 50, 4);
  assert.ok(sharedMaterial.batchId && replacementMaterial.batchId);
  const skuC = await createSku(tenant.id, "缺货主花", 80, [
    { materialId: shortMaterial.materialId, qty: 1 },
  ]);
  const skuD = await createSku(tenant.id, "共享配花", 60, [
    { materialId: sharedMaterial.materialId, qty: 1 },
  ]);
  const substitutionOrderId = await createManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, deliveryAt: futureDate(6), fulfillmentKind: "PICKUP",
    items: [
      { skuId: skuC.skuId, quantity: 1 },
      { skuId: skuD.skuId, quantity: 1 },
    ],
  });
  assert.deepEqual(await confirmManualOrder(db, substitutionOrderId, tenant.id, store.id), {
    covered: false, totalShortage: 1,
  });
  const confirmAuditCount = () => db.auditEvent.count({
    where: { action: "ORDER_CONFIRMED", entityType: "Order", entityId: substitutionOrderId },
  });
  assert.equal(await confirmAuditCount(), 1);
  const pendingBeforeReplay = await db.order.findUniqueOrThrow({ where: { id: substitutionOrderId } });
  assert.deepEqual(await confirmManualOrder(db, substitutionOrderId, tenant.id, store.id), {
    covered: false, totalShortage: 1,
  });
  const pendingAfterReplay = await db.order.findUniqueOrThrow({ where: { id: substitutionOrderId } });
  assert.equal(pendingAfterReplay.commercialState, pendingBeforeReplay.commercialState);
  assert.equal(pendingAfterReplay.supplyState, pendingBeforeReplay.supplyState);
  assert.equal(pendingAfterReplay.productionState, pendingBeforeReplay.productionState);
  assert.equal(await confirmAuditCount(), 1, "a no-op confirmation replay must not append another audit event");
  let substitutionOrder = await loadOrder(substitutionOrderId);
  const substitutionItemC = substitutionOrder.items.find((item) => item.skuId === skuC.skuId);
  const substitutionItemD = substitutionOrder.items.find((item) => item.skuId === skuD.skuId);
  assert.ok(substitutionItemC && substitutionItemD);
  const shortRequirement = substitutionItemC.requirements.find(
    (requirement) => requirement.revisionId === substitutionOrder.revisions.at(-1)!.id,
  );
  assert.ok(shortRequirement);
  const substitution = await substituteOrderMaterial(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: substitutionOrderId,
    requirementId: shortRequirement.id,
    replacementMaterialId: replacementMaterial.materialId,
    replacementQty: 1,
    reason: "缺货人工替换",
    customerConfirmed: true,
    actorStaffId: "staff-test",
  });
  assert.equal(substitution.covered, true);

  const substitutionRevision = await reviseManualOrder(db, {
    tenantId: tenant.id,
    storeId: store.id,
    orderId: substitutionOrderId,
    deliveryAt: futureDate(7),
    items: [
      { orderItemId: substitutionItemC.id, quantity: 2 },
      { orderItemId: substitutionItemD.id, quantity: 3 },
    ],
  });
  substitutionOrder = await loadOrder(substitutionOrderId);
  const finalRequirements = latestRequirementsByItem(substitutionOrder, substitutionRevision.revisionId);
  const finalC = finalRequirements.get(substitutionItemC.id) ?? [];
  const finalD = finalRequirements.get(substitutionItemD.id) ?? [];
  assert.equal(finalC.length, 1);
  assert.equal(finalC[0].materialId, replacementMaterial.materialId);
  assert.equal(Number(finalC[0].plannedQty), 2);
  assert.equal(finalD.length, 1);
  assert.equal(finalD[0].materialId, sharedMaterial.materialId);
  assert.equal(Number(finalD[0].plannedQty), 3);
  assert.equal(substitutionOrder.commercialState, CommercialState.CONFIRMED);
  console.log("multi-order revision preserves substitution passed");

  console.log("v2 multi-line manual order tests passed");
}

async function cleanup() {
  const tenantIds = [primaryTenantId, secondaryTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.costAdjustment.deleteMany({ where: { order: tenants } });
  await db.orderCostSnapshot.deleteMany({ where: { order: tenants } });
  await db.lossRecord.deleteMany({ where: { order: tenants } });
  await db.costEntry.deleteMany({ where: { order: tenants } });
  await db.materialUsage.deleteMany({ where: { task: { orderItem: { order: tenants } } } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.deliveryAttempt.deleteMany({ where: { fulfillment: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.auditEvent.deleteMany({ where: tenants });
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
      console.error("multi-order cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
