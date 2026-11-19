import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, LocationKind, MaterialKind, PrismaClient, PurchaseState,
  ReceiptDisposition, ReservationState, SupplyState,
} from "../../generated/prisma-v2/client";
import { allocatePurchaseDemand } from "./allocate-purchase-demand";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import { receivePurchaseLine } from "./receive-purchase-line";
import { recheckSupplyAfterReceipt } from "./recheck-supply";
import { rejectPurchaseLine } from "./reject-purchase-line";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for purchase-demand tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Catalog = {
  materialId: string;
  materialCode: string;
  baseUnit: string;
  quantityScale: number;
  skuId: string;
};

type Purchase = { purchaseOrderId: string; purchaseLineId: string; supplierId: string };

async function createCatalog(
  label: string,
  options: { onHand?: number; perUnitQuantity?: number; quantityScale?: number } = {},
): Promise<Catalog> {
  assert.ok(tenantId && storeId);
  const { onHand = 0, perUnitQuantity = 5, quantityScale = 0 } = options;
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId, code: `MAT-${code}`, name: `${label} 测试花材`,
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale,
    },
  });
  if (onHand > 0) {
    assert.ok(warehouseId);
    const batch = await db.inventoryBatch.create({
      data: { storeId, materialId: material.id, batchNo: `BATCH-${code}`, unitCost: 1 },
    });
    await db.batchBalance.create({
      data: { batchId: batch.id, locationId: warehouseId, onHandQty: onHand },
    });
  }
  const product = await db.product.create({
    data: { tenantId, code: `PROD-${code}`, name: `${label} 测试花束` },
  });
  const sku = await db.productSku.create({
    data: {
      productId: product.id, code: `SKU-${code}`, name: "标准款", price: 99,
      estimatedConsumableCost: 1, estimatedLaborCost: 2, active: true,
    },
  });
  await db.product.update({ where: { id: product.id }, data: { active: true, defaultSkuId: sku.id } });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  await db.recipeVersion.create({
    data: {
      recipeId: recipe.id, versionNo: 1, state: "PUBLISHED", publishedAt: new Date(),
      lines: { create: { materialId: material.id, plannedQty: perUnitQuantity } },
    },
  });
  return {
    materialId: material.id,
    materialCode: material.code,
    baseUnit: material.baseUnit,
    quantityScale,
    skuId: sku.id,
  };
}

async function createOrder(catalog: Catalog, quantity = 1, createdAt?: Date): Promise<string> {
  assert.ok(tenantId && storeId);
  const orderId = await createManualOrder(db, {
    tenantId, storeId, skuId: catalog.skuId, quantity,
    deliveryAt: futureDate(3), fulfillmentKind: "PICKUP",
    buyerName: "采购需求分配测试",
  });
  if (createdAt) await db.order.update({ where: { id: orderId }, data: { createdAt } });
  return orderId;
}

async function confirmShortage(orderId: string): Promise<void> {
  assert.ok(tenantId && storeId);
  const result = await confirmManualOrder(db, orderId, tenantId, storeId);
  assert.equal(result.covered, false);
  assert.ok(result.totalShortage > 0);
}

async function latestRequirement(orderId: string, materialId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      revisions: { orderBy: { number: "desc" }, take: 1 },
      items: { include: { requirements: true } },
    },
  });
  const latestRevision = order.revisions[0];
  assert.ok(latestRevision);
  const requirement = order.items
    .flatMap((item) => item.requirements)
    .find((entry) => entry.revisionId === latestRevision.id && entry.materialId === materialId);
  assert.ok(requirement);
  return requirement;
}

async function createOpenPurchase(
  material: { id: string; baseUnit: string; name: string },
  expectedBaseQty: number,
  expectedAt?: Date,
): Promise<Purchase> {
  assert.ok(tenantId && storeId);
  const suffix = crypto.randomUUID().slice(0, 8);
  const supplier = await db.supplier.create({
    data: { tenantId, code: `SUP-${marker}-${suffix}`, name: `测试供应商 ${suffix}` },
  });
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      tenantId, storeId, supplierId: supplier.id,
      number: `PO-${marker}-${suffix}`, state: PurchaseState.ORDERED, expectedAt,
    },
  });
  const line = await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: purchaseOrder.id, materialId: material.id,
      orderedQty: expectedBaseQty, purchaseUnit: material.baseUnit,
      expectedBaseQty, unitPrice: 1,
    },
  });
  return { purchaseOrderId: purchaseOrder.id, purchaseLineId: line.id, supplierId: supplier.id };
}

async function allocate(
  requirementId: string,
  purchaseLineId: string,
  quantity: number,
  overrides: { tenantId?: string; storeId?: string } = {},
) {
  assert.ok(tenantId && storeId);
  const currentTenantId = tenantId;
  const currentStoreId = storeId;
  return db.$transaction((tx) => allocatePurchaseDemand(tx, {
    tenantId: overrides.tenantId ?? currentTenantId,
    storeId: overrides.storeId ?? currentStoreId,
    purchaseLineId,
    requirementId,
    quantity,
    actorStaffId: "staff-allocate-test",
  }));
}

async function receive(
  purchaseLineId: string,
  acceptedMaterialId: string,
  quantity: number,
  disposition: "ACCEPTED" | "DOWNGRADED" = "ACCEPTED",
  gradeChangeReason?: string,
) {
  assert.ok(warehouseId);
  const currentTenantId = tenantId;
  const currentWarehouseId = warehouseId;
  if (!currentTenantId) throw new Error("test tenant is required");
  const batchId = await db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: currentTenantId,
    actorStaffId: "staff-allocate-test",
    purchaseLineId,
    locationId: currentWarehouseId,
    acceptedMaterialId,
    quantity,
    batchNo: `B-${marker}-${crypto.randomUUID().slice(0, 6)}`,
    disposition: disposition === "DOWNGRADED" ? ReceiptDisposition.DOWNGRADED : ReceiptDisposition.ACCEPTED,
    gradeChangeReason,
    finalUnitCost: 1,
    idempotencyKey: `RECEIPT-${marker}-${crypto.randomUUID()}`,
  }));
  return db.inventoryBatch.findUniqueOrThrow({ where: { id: batchId }, include: { balances: true } });
}

async function reject(
  purchaseLineId: string,
  quantity: number,
  reason = "验收不合格",
) {
  const currentTenantId = tenantId;
  const currentStoreId = storeId;
  if (!currentTenantId || !currentStoreId) throw new Error("test tenant/store is required");
  return db.$transaction((tx) => rejectPurchaseLine(tx, {
    tenantId: currentTenantId,
    storeId: currentStoreId,
    purchaseLineId,
    quantity,
    reason,
    actorStaffId: "staff-allocate-test",
    idempotencyKey: `REJECT-${marker}-${crypto.randomUUID()}`,
  }));
}

async function allocationTotal(requirementId: string): Promise<number> {
  const rows = await db.purchaseDemandAllocation.findMany({ where: { requirementId } });
  return rows.reduce((sum, row) => sum + Number(row.allocatedQty), 0);
}

async function activeReservations(requirementId: string): Promise<number> {
  const rows = await db.inventoryReservation.findMany({
    where: { requirementId, state: ReservationState.ACTIVE },
  });
  return rows.reduce((sum, row) => sum + Number(row.quantity), 0);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-purchase-demand-${marker}`, name: "Phase 1 采购需求测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 采购需求测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;

  // Allocation is a pure attribution: no inventory reservation or batch change.
  const main = await createCatalog("main", { onHand: 0, perUnitQuantity: 5, quantityScale: 1 });
  const mainOrderId = await createOrder(main);
  await confirmShortage(mainOrderId);
  const mainRequirement = await latestRequirement(mainOrderId, main.materialId);
  const mainMaterial = await db.material.findUniqueOrThrow({ where: { id: main.materialId } });
  const lineA = await createOpenPurchase(mainMaterial, 6, futureDate(1));

  const first = await allocate(mainRequirement.id, lineA.purchaseLineId, 2.5);
  assert.equal(first.changed, true);
  assert.equal(first.allocatedQty, 2.5);
  assert.equal(first.requirement.plannedQty, 5);
  assert.equal(first.requirement.currentShortage, 5);
  assert.equal(first.requirement.allocatedQty, 2.5);
  assert.equal(first.requirement.remainingShortage, 2.5);
  assert.equal(first.purchaseLine.expectedBaseQty, 6);
  assert.equal(first.purchaseLine.remainingQty, 3.5);
  assert.equal(await allocationTotal(mainRequirement.id), 2.5);
  assert.equal(await activeReservations(mainRequirement.id), 0);
  assert.equal(await db.inventoryTransaction.count({ where: { batch: { storeId } } }), 0);
  assert.equal(await db.auditEvent.count({
    where: { entityId: first.allocationId ?? "", action: "PURCHASE_DEMAND_ALLOCATED" },
  }), 1);

  // Exact retry is an idempotent no-op; increasing below both caps adjusts the same row.
  const retry = await allocate(mainRequirement.id, lineA.purchaseLineId, 2.5);
  assert.equal(retry.changed, false);
  assert.equal(await allocationTotal(mainRequirement.id), 2.5);
  assert.equal(await db.purchaseDemandAllocation.count({ where: { requirementId: mainRequirement.id } }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: first.allocationId ?? "", action: "PURCHASE_DEMAND_ALLOCATED" },
  }), 1);

  const increased = await allocate(mainRequirement.id, lineA.purchaseLineId, 4);
  assert.equal(await db.auditEvent.count({
    where: { entityId: first.allocationId ?? "", action: "PURCHASE_DEMAND_ALLOCATED" },
  }), 2);
  assert.equal(increased.changed, true);
  assert.equal(increased.requirement.remainingShortage, 1);
  assert.equal(increased.purchaseLine.remainingQty, 2);
  assert.equal(await allocationTotal(mainRequirement.id), 4);

  await assert.rejects(
    allocate(mainRequirement.id, lineA.purchaseLineId, 5.5),
    /超过需求剩余缺口/,
  );
  assert.equal(await allocationTotal(mainRequirement.id), 4);

  await assert.rejects(
    allocate(mainRequirement.id, lineA.purchaseLineId, 0.25),
    /计量精度/,
  );

  const lateLine = await createOpenPurchase(mainMaterial, 10, futureDate(10));
  await assert.rejects(
    allocate(mainRequirement.id, lateLine.purchaseLineId, 4.5),
    /预计到货时间/,
  );

  // A different purchase line cannot exceed its own expected base quantity.
  const secondOrderId = await createOrder(main);
  await confirmShortage(secondOrderId);
  const secondRequirement = await latestRequirement(secondOrderId, main.materialId);
  const shortLine = await createOpenPurchase(mainMaterial, 3, futureDate(1));
  await assert.rejects(
    allocate(secondRequirement.id, shortLine.purchaseLineId, 4),
    /未处理可分配数量/,
  );
  assert.equal(await allocationTotal(secondRequirement.id), 0);

  // A PARTIALLY_RECEIVED line only exposes expected quantity minus accepted/downgraded receipts.
  const partial = await createCatalog("partial-receipt", { perUnitQuantity: 5 });
  const partialMaterial = await db.material.findUniqueOrThrow({ where: { id: partial.materialId } });
  const partialOrderId = await createOrder(partial, 3);
  await confirmShortage(partialOrderId);
  const partialRequirement = await latestRequirement(partialOrderId, partial.materialId);
  const partialLine = await createOpenPurchase(partialMaterial, 10, futureDate(1));
  await receive(partialLine.purchaseLineId, partial.materialId, 4, "ACCEPTED");
  const partialAcceptedMaterial = await db.material.create({
    data: {
      tenantId: tenant.id, code: `PARTIAL-ACCEPTED-${marker}`, name: "部分降级物料",
      kind: MaterialKind.FLOWER, baseUnit: partialMaterial.baseUnit, quantityScale: 0,
    },
  });
  await receive(
    partialLine.purchaseLineId, partialAcceptedMaterial.id, 2, "DOWNGRADED", "部分到货降级",
  );
  const partialPurchase = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: partialLine.purchaseOrderId },
  });
  assert.equal(partialPurchase.state, PurchaseState.PARTIALLY_RECEIVED);

  await assert.rejects(
    allocate(partialRequirement.id, partialLine.purchaseLineId, 5),
    /未处理可分配数量 4/,
  );
  assert.equal(await allocationTotal(partialRequirement.id), 0);

  const partialAllocation = await allocate(partialRequirement.id, partialLine.purchaseLineId, 4);
  assert.equal(partialAllocation.changed, true);
  assert.equal(partialAllocation.purchaseLine.expectedBaseQty, 10);
  assert.equal(partialAllocation.purchaseLine.receivedQty, 6);
  assert.equal(partialAllocation.purchaseLine.outstandingQty, 4);
  assert.equal(partialAllocation.purchaseLine.allocatedQty, 4);
  assert.equal(partialAllocation.purchaseLine.remainingQty, 0);
  assert.equal(await allocationTotal(partialRequirement.id), 4);

  // Existing exact allocation retry remains a successful no-op after the receipt.
  const partialRetry = await allocate(partialRequirement.id, partialLine.purchaseLineId, 4);
  assert.equal(partialRetry.changed, false);
  assert.equal(partialRetry.allocationId, partialAllocation.allocationId);
  assert.equal(partialRetry.allocatedQty, 4);
  assert.equal(await allocationTotal(partialRequirement.id), 4);
  assert.equal(
    await db.purchaseDemandAllocation.count({ where: { requirementId: partialRequirement.id } }),
    1,
  );

  await assert.rejects(
    allocate(partialRequirement.id, partialLine.purchaseLineId, 5),
    /未处理可分配数量 0/,
  );

  // Rejections consume the same cumulative capacity as accepted/downgraded receipts.
  const rejectionCatalog = await createCatalog("rejected-capacity", { perUnitQuantity: 5 });
  const rejectionMaterial = await db.material.findUniqueOrThrow({
    where: { id: rejectionCatalog.materialId },
  });
  const rejectionOrderId = await createOrder(rejectionCatalog);
  await confirmShortage(rejectionOrderId);
  const rejectionRequirement = await latestRequirement(rejectionOrderId, rejectionCatalog.materialId);
  const rejectionLine = await createOpenPurchase(rejectionMaterial, 5, futureDate(1));
  await receive(rejectionLine.purchaseLineId, rejectionCatalog.materialId, 2);
  const rejectionResult = await reject(rejectionLine.purchaseLineId, 2, "花头压伤");
  assert.equal(rejectionResult.progress.acceptedOriginalQty, 2);
  assert.equal(rejectionResult.progress.rejectedQty, 2);
  assert.equal(rejectionResult.progress.processedQty, 4);
  assert.equal(rejectionResult.progress.remainingQty, 1);
  await assert.rejects(
    allocate(rejectionRequirement.id, rejectionLine.purchaseLineId, 2),
    /未处理可分配数量 1/,
  );
  const rejectedCapacityAllocation = await allocate(
    rejectionRequirement.id, rejectionLine.purchaseLineId, 1,
  );
  assert.equal(rejectedCapacityAllocation.purchaseLine.acceptedOriginalQty, 2);
  assert.equal(rejectedCapacityAllocation.purchaseLine.downgradedQty, 0);
  assert.equal(rejectedCapacityAllocation.purchaseLine.rejectedQty, 2);
  assert.equal(rejectedCapacityAllocation.purchaseLine.processedQty, 4);
  assert.equal(rejectedCapacityAllocation.purchaseLine.remainingQty, 0);

  await reject(rejectionLine.purchaseLineId, 1, "剩余全部拒收");
  const fullyProcessed = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: rejectionLine.purchaseOrderId },
  });
  assert.equal(fullyProcessed.state, PurchaseState.RECEIVED);
  // A fully processed line is closed to new/changed attribution; retries cannot duplicate it.
  await assert.rejects(
    allocate(rejectionRequirement.id, rejectionLine.purchaseLineId, 1),
    /已关闭/,
  );
  await assert.rejects(
    allocate(rejectionRequirement.id, rejectionLine.purchaseLineId, 2),
    /已关闭/,
  );
  assert.equal(await allocationTotal(rejectionRequirement.id), 1);

  // Wrong material, wrong store and wrong tenant are rejected without writing.
  const otherMaterial = await db.material.create({
    data: {
      tenantId: tenant.id, code: `OTHER-${marker}`, name: "其他物料",
      kind: MaterialKind.FOLIAGE, baseUnit: "支", quantityScale: 0,
    },
  });
  const otherLine = await createOpenPurchase(otherMaterial, 5, futureDate(1));
  await assert.rejects(
    allocate(secondRequirement.id, otherLine.purchaseLineId, 1),
    /不是同一物料/,
  );
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: `SECOND-${marker}`, name: "另一门店" },
  });
  const otherStoreSupplier = await db.supplier.create({
    data: { tenantId: tenant.id, code: `SUP-OTHER-${marker}`, name: "另一门店供应商" },
  });
  const otherStorePurchase = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id, storeId: otherStore.id, supplierId: otherStoreSupplier.id,
      number: `PO-OTHER-${marker}`, state: PurchaseState.ORDERED, expectedAt: futureDate(1),
    },
  });
  const otherStoreLine = await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: otherStorePurchase.id, materialId: main.materialId,
      orderedQty: 5, purchaseUnit: mainMaterial.baseUnit, expectedBaseQty: 5, unitPrice: 1,
    },
  });
  await assert.rejects(
    allocate(secondRequirement.id, otherStoreLine.id, 1),
    /不属于当前门店/,
  );
  await assert.rejects(
    allocate(secondRequirement.id, lineA.purchaseLineId, 1, { tenantId: crypto.randomUUID() }),
    /不属于当前门店/,
  );
  assert.equal(await allocationTotal(secondRequirement.id), 0);

  // Historical revisions cannot receive a new allocation.
  const { reviseManualOrder } = await import("./revise-order");
  await reviseManualOrder(db, {
    tenantId: tenant.id, storeId, orderId: mainOrderId, quantity: 2, deliveryAt: futureDate(3),
  });
  await assert.rejects(
    allocate(mainRequirement.id, lineA.purchaseLineId, 4.5),
    /最新版/,
  );

  // Concurrent revision/allocation: order-first locking must not deadlock, and an allocation
  // queued behind a revision must reject the now-historical requirement.
  const concurrentRevision = await createCatalog("concurrent-revision");
  const concurrentRevisionMaterial = await db.material.findUniqueOrThrow({
    where: { id: concurrentRevision.materialId },
  });
  const concurrentRevisionOrderId = await createOrder(concurrentRevision);
  await confirmShortage(concurrentRevisionOrderId);
  const concurrentRevisionRequirement = await latestRequirement(
    concurrentRevisionOrderId, concurrentRevision.materialId,
  );
  const concurrentRevisionLine = await createOpenPurchase(
    concurrentRevisionMaterial, 10, futureDate(1),
  );

  let releaseOrderLock: () => void = () => {};
  let signalOrderLocked: () => void = () => {};
  const orderLocked = new Promise<void>((resolve) => { signalOrderLocked = resolve; });
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${concurrentRevisionOrderId} FOR UPDATE`;
    signalOrderLocked();
    await new Promise<void>((resolve) => { releaseOrderLock = resolve; });
  });
  await orderLocked;
  const concurrentRevisionPromise = reviseManualOrder(db, {
    tenantId: tenant.id, storeId, orderId: concurrentRevisionOrderId,
    quantity: 2, deliveryAt: futureDate(4),
  });
  await delay(500);
  const concurrentAllocationPromise = allocate(
    concurrentRevisionRequirement.id, concurrentRevisionLine.purchaseLineId, 5,
  );
  await delay(500);
  releaseOrderLock();
  const [revisionOutcome, allocationOutcome] = await Promise.allSettled([
    concurrentRevisionPromise, concurrentAllocationPromise,
  ]);
  await blocker;
  assert.equal(revisionOutcome.status, "fulfilled");
  assert.equal(allocationOutcome.status, "rejected");
  assert.match(String((allocationOutcome as PromiseRejectedResult).reason), /最新版/);
  const concurrentLatestRequirement = await latestRequirement(
    concurrentRevisionOrderId, concurrentRevision.materialId,
  );
  assert.notEqual(concurrentLatestRequirement.id, concurrentRevisionRequirement.id);
  assert.equal(await allocationTotal(concurrentRevisionRequirement.id), 0);
  assert.equal(await allocationTotal(concurrentLatestRequirement.id), 0);

  // Requirement-side concurrency: two lines racing for the same shortage cannot over-allocate.
  const raceRequirementCatalog = await createCatalog("race-requirement");
  const raceOrderId = await createOrder(raceRequirementCatalog);
  await confirmShortage(raceOrderId);
  const raceRequirement = await latestRequirement(raceOrderId, raceRequirementCatalog.materialId);
  const raceMaterial = await db.material.findUniqueOrThrow({ where: { id: raceRequirementCatalog.materialId } });
  const raceLineA = await createOpenPurchase(raceMaterial, 5, futureDate(1));
  const raceLineB = await createOpenPurchase(raceMaterial, 5, futureDate(1));
  const requirementRace = await Promise.allSettled([
    allocate(raceRequirement.id, raceLineA.purchaseLineId, 5),
    allocate(raceRequirement.id, raceLineB.purchaseLineId, 5),
  ]);
  assert.equal(requirementRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(requirementRace.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await allocationTotal(raceRequirement.id), 5);

  // Purchase-line-side concurrency: two requirements racing for the same line cannot exceed it.
  const raceLineCatalog = await createCatalog("race-line");
  const raceLineMaterial = await db.material.findUniqueOrThrow({ where: { id: raceLineCatalog.materialId } });
  const raceLine = await createOpenPurchase(raceLineMaterial, 5, futureDate(1));
  const raceLineOrderA = await createOrder(raceLineCatalog);
  const raceLineOrderB = await createOrder(raceLineCatalog);
  await confirmShortage(raceLineOrderA);
  await confirmShortage(raceLineOrderB);
  const raceLineRequirementA = await latestRequirement(raceLineOrderA, raceLineCatalog.materialId);
  const raceLineRequirementB = await latestRequirement(raceLineOrderB, raceLineCatalog.materialId);
  const lineRace = await Promise.allSettled([
    allocate(raceLineRequirementA.id, raceLine.purchaseLineId, 5),
    allocate(raceLineRequirementB.id, raceLine.purchaseLineId, 5),
  ]);
  assert.equal(lineRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(lineRace.filter((result) => result.status === "rejected").length, 1);
  const raceLineRows = await db.purchaseDemandAllocation.findMany({
    where: { purchaseLineId: raceLine.purchaseLineId },
  });
  assert.equal(raceLineRows.reduce((sum, row) => sum + Number(row.allocatedQty), 0), 5);

  // Receipt recheck: the newer explicitly linked order wins the first available stock,
  // while the older unlinked order remains pending until a later receipt.
  const priority = await createCatalog("priority");
  const priorityMaterial = await db.material.findUniqueOrThrow({ where: { id: priority.materialId } });
  const olderOrderId = await createOrder(priority, 1, new Date(Date.now() - 60_000));
  const linkedOrderId = await createOrder(priority, 1);
  await confirmShortage(olderOrderId);
  await confirmShortage(linkedOrderId);
  const linkedRequirement = await latestRequirement(linkedOrderId, priority.materialId);
  const priorityLine = await createOpenPurchase(priorityMaterial, 5, futureDate(1));
  await allocate(linkedRequirement.id, priorityLine.purchaseLineId, 5);
  const priorityBatch = await receive(priorityLine.purchaseLineId, priority.materialId, 5);
  assert.equal(priorityBatch.materialId, priority.materialId);
  assert.deepEqual(
    await recheckSupplyAfterReceipt(db, tenant.id, storeId, priority.materialId, {
      purchaseLineId: priorityLine.purchaseLineId,
    }),
    { checked: 2, failed: 0 },
  );
  const linkedOrder = await db.order.findUniqueOrThrow({ where: { id: linkedOrderId } });
  const olderOrder = await db.order.findUniqueOrThrow({ where: { id: olderOrderId } });
  assert.equal(linkedOrder.commercialState, CommercialState.CONFIRMED);
  assert.equal(linkedOrder.supplyState, SupplyState.ON_HAND_COVERED);
  assert.equal(olderOrder.commercialState, CommercialState.PENDING_CONFIRMATION);
  assert.equal(olderOrder.supplyState, SupplyState.PURCHASE_REQUIRED);
  assert.equal(await activeReservations(linkedRequirement.id), 5);
  assert.equal(await activeReservations(await latestRequirement(olderOrderId, priority.materialId).then((row) => row.id)), 0);

  // Unlinked recovery still works: a later receipt for the same material restores the older order.
  const laterLine = await createOpenPurchase(priorityMaterial, 5, futureDate(1));
  await receive(laterLine.purchaseLineId, priority.materialId, 5);
  assert.deepEqual(
    await recheckSupplyAfterReceipt(db, tenant.id, storeId, priority.materialId),
    { checked: 1, failed: 0 },
  );
  assert.equal(
    (await db.order.findUniqueOrThrow({ where: { id: olderOrderId } })).commercialState,
    CommercialState.CONFIRMED,
  );

  // A downgraded receipt must not satisfy the original linked material requirement.
  const downgrade = await createCatalog("downgrade");
  const downgradeMaterial = await db.material.findUniqueOrThrow({ where: { id: downgrade.materialId } });
  const acceptedMaterial = await db.material.create({
    data: {
      tenantId: tenant.id, code: `ACCEPTED-${marker}`, name: "降级后物料",
      kind: MaterialKind.FLOWER, baseUnit: downgradeMaterial.baseUnit, quantityScale: 0,
    },
  });
  const downgradeOrderId = await createOrder(downgrade);
  await confirmShortage(downgradeOrderId);
  const downgradeRequirement = await latestRequirement(downgradeOrderId, downgrade.materialId);
  const downgradeLine = await createOpenPurchase(downgradeMaterial, 5, futureDate(1));
  await allocate(downgradeRequirement.id, downgradeLine.purchaseLineId, 5);
  const downgradedBatch = await receive(
    downgradeLine.purchaseLineId, acceptedMaterial.id, 5, "DOWNGRADED", "等级不足，降级入库",
  );
  assert.equal(downgradedBatch.materialId, acceptedMaterial.id);
  assert.deepEqual(
    await recheckSupplyAfterReceipt(db, tenant.id, storeId, acceptedMaterial.id, {
      purchaseLineId: downgradeLine.purchaseLineId,
    }),
    { checked: 1, failed: 0 },
  );
  const downgradeOrder = await db.order.findUniqueOrThrow({ where: { id: downgradeOrderId } });
  assert.equal(downgradeOrder.commercialState, CommercialState.PENDING_CONFIRMATION);
  assert.equal(downgradeOrder.supplyState, SupplyState.PURCHASE_REQUIRED);
  assert.equal(await activeReservations(downgradeRequirement.id), 0);
  assert.equal(await allocationTotal(downgradeRequirement.id), 5);
  assert.equal(
    downgradedBatch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
    5,
  );

  console.log("v2 allocate-purchase-demand tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.purchaseDemandAllocation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.goodsReceiptLine.deleteMany({ where: { receipt: { store: tenants } } });
  await db.goodsReceipt.deleteMany({ where: { store: tenants } });
  await db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: tenants } });
  await db.purchaseOrder.deleteMany({ where: tenants });
  await db.supplier.deleteMany({ where: tenants });
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
      console.error("allocate-purchase-demand cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
