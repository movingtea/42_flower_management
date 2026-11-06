import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, LocationKind, MaterialKind, OrderEntry, OrderItemKind,
  PrismaClient, PurchaseState, SupplyState,
} from "../../generated/prisma-v2-draft/client";
import { calculatePurchaseProgress } from "../domain/purchase-progress";
import { receivePurchaseLine } from "./receive-purchase-line";
import { rejectPurchaseLine } from "./reject-purchase-line";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for rejection tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;
let warehouseId: string | undefined;

type Material = {
  id: string;
  code: string;
  baseUnit: string;
  quantityScale: number;
};

type Purchase = {
  purchaseOrderId: string;
  purchaseLineId: string;
  supplierId: string;
};

async function createMaterial(label: string, quantityScale = 0): Promise<Material> {
  assert.ok(tenantId);
  const code = `${label}-${marker}-${crypto.randomUUID().slice(0, 5)}`;
  const material = await db.material.create({
    data: {
      tenantId,
      code: `MAT-${code}`,
      name: `${label} 拒收测试花材`,
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale,
    },
  });
  return {
    id: material.id,
    code: material.code,
    baseUnit: material.baseUnit,
    quantityScale: material.quantityScale,
  };
}

async function createPurchase(
  material: Material,
  expectedBaseQty: number,
  orderedQty = expectedBaseQty,
): Promise<Purchase> {
  assert.ok(tenantId && storeId);
  const suffix = crypto.randomUUID().slice(0, 8);
  const supplier = await db.supplier.create({
    data: {
      tenantId,
      code: `SUP-${marker}-${suffix}`,
      name: `拒收测试供应商 ${suffix}`,
    },
  });
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      tenantId,
      storeId,
      supplierId: supplier.id,
      number: `PO-${marker}-${suffix}`,
      state: PurchaseState.ORDERED,
      expectedAt: futureDate(2),
    },
  });
  const line = await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: purchaseOrder.id,
      materialId: material.id,
      orderedQty,
      purchaseUnit: material.baseUnit,
      expectedBaseQty,
      unitPrice: 1,
    },
  });
  return {
    purchaseOrderId: purchaseOrder.id,
    purchaseLineId: line.id,
    supplierId: supplier.id,
  };
}

async function receive(
  lineId: string,
  acceptedMaterialId: string,
  quantity: number,
  key = `RECEIPT-${marker}-${crypto.randomUUID()}`,
): Promise<string> {
  assert.ok(tenantId && warehouseId);
  return db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenantId!,
    actorStaffId: `staff-${marker}`,
    purchaseLineId: lineId,
    locationId: warehouseId!,
    acceptedMaterialId,
    quantity,
    batchNo: `B-${marker}-${crypto.randomUUID().slice(0, 6)}`,
    disposition: "ACCEPTED",
    finalUnitCost: 1,
    idempotencyKey: key,
  }));
}

type RejectOptions = {
  key?: string;
  tenantId?: string;
  storeId?: string;
};

async function reject(
  lineId: string,
  quantity: number,
  reason = "花头损坏",
  options: RejectOptions = {},
) {
  assert.ok(tenantId && storeId);
  return db.$transaction((tx) => rejectPurchaseLine(tx, {
    tenantId: options.tenantId ?? tenantId!,
    storeId: options.storeId ?? storeId!,
    purchaseLineId: lineId,
    quantity,
    reason,
    actorStaffId: `staff-${marker}`,
    idempotencyKey: options.key ?? `REJECT-${marker}-${crypto.randomUUID()}`,
  }));
}

async function lineProgress(lineId: string, expectedBaseQty: number) {
  const rows = await db.goodsReceiptLine.findMany({
    where: { purchaseLineId: lineId },
    select: { disposition: true, quantity: true },
  });
  return calculatePurchaseProgress(expectedBaseQty, rows.map((row) => ({
    disposition: row.disposition,
    quantity: Number(row.quantity),
  })));
}

async function receiptLineCount(lineId: string): Promise<number> {
  return db.goodsReceiptLine.count({ where: { purchaseLineId: lineId } });
}

async function rejectAuditCount(lineId: string): Promise<number> {
  return db.auditEvent.count({
    where: {
      action: "PURCHASE_LINE_REJECTED",
      entityType: "PurchaseOrderLine",
      entityId: lineId,
    },
  });
}

async function createLinkedOrder(
  purchaseLineId: string,
  materialId: string,
): Promise<string> {
  assert.ok(tenantId && storeId);
  const suffix = crypto.randomUUID().slice(0, 8);
  const order = await db.order.create({
    data: {
      tenantId,
      storeId,
      number: `ORD-${marker}-${suffix}`,
      createdVia: OrderEntry.STAFF_PORTAL,
      sourceChannel: "TEST",
      commercialState: CommercialState.PENDING_CONFIRMATION,
      supplyState: SupplyState.PURCHASE_REQUIRED,
    },
  });
  const revision = await db.orderRevision.create({
    data: { orderId: order.id, number: 1 },
  });
  const item = await db.orderItem.create({
    data: {
      orderId: order.id,
      kind: OrderItemKind.STANDARD,
      nameSnapshot: "拒收关联订单测试",
      quantity: 1,
      unitPrice: 1,
    },
  });
  const requirement = await db.orderMaterialRequirement.create({
    data: {
      orderItemId: item.id,
      revisionId: revision.id,
      materialId,
      plannedQty: 3,
      needBy: futureDate(2),
    },
  });
  await db.purchaseDemandAllocation.create({
    data: {
      purchaseLineId,
      requirementId: requirement.id,
      allocatedQty: 3,
    },
  });
  return order.id;
}

async function main() {
  const tenant = await db.tenant.create({
    data: {
      slug: `phase1-reject-${marker}`,
      name: "Phase 1 拒收测试租户",
    },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 拒收测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;

  // 3) All-rejected purchase: the state is RECEIVED, but no inventory is created.
  const allRejected = await createPurchase(await createMaterial("all-rejected"), 2);
  const allRejectedMaterial = (await db.purchaseOrderLine.findUniqueOrThrow({
    where: { id: allRejected.purchaseLineId },
    include: { material: true },
  })).material;
  const allRejectedResult = await reject(allRejected.purchaseLineId, 2, "整批拒收");
  assert.equal(allRejectedResult.purchaseState, "RECEIVED");
  assert.deepEqual(allRejectedResult.progress, {
    acceptedOriginalQty: 0,
    downgradedQty: 0,
    rejectedQty: 2,
    processedQty: 2,
    remainingQty: 0,
    state: "RECEIVED",
    hasRejection: true,
    expectedBaseQty: 2,
  });
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: allRejected.purchaseOrderId },
  })).state, PurchaseState.RECEIVED);
  assert.equal(await db.inventoryBatch.count({
    where: { storeId, materialId: allRejectedMaterial.id },
  }), 0);
  assert.equal(await db.batchBalance.count({
    where: { batch: { storeId, materialId: allRejectedMaterial.id } },
  }), 0);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { storeId, materialId: allRejectedMaterial.id } },
  }), 0);
  assert.equal(await rejectAuditCount(allRejected.purchaseLineId), 1);

  // 4) Invalid quantities and blank reasons are rejected before any write.
  const invalidMaterial = await createMaterial("invalid");
  const invalid = await createPurchase(invalidMaterial, 5);
  for (const quantity of [0, -1, 0.5, Number.NaN]) {
    await assert.rejects(reject(invalid.purchaseLineId, quantity), /拒收数量/);
  }
  for (const reason of ["", "   "]) {
    await assert.rejects(reject(invalid.purchaseLineId, 1, reason), /拒收原因/);
  }
  assert.equal(await receiptLineCount(invalid.purchaseLineId), 0);
  assert.equal(await rejectAuditCount(invalid.purchaseLineId), 0);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: invalid.purchaseOrderId },
  })).state, PurchaseState.ORDERED);
  assert.deepEqual(await lineProgress(invalid.purchaseLineId, 5), {
    acceptedOriginalQty: 0,
    downgradedQty: 0,
    rejectedQty: 0,
    processedQty: 0,
    remainingQty: 5,
    state: "ORDERED",
    hasRejection: false,
  });

  // 2) Accumulated accepted + rejected cannot exceed the expected quantity.
  const cappedMaterial = await createMaterial("cumulative");
  const capped = await createPurchase(cappedMaterial, 5);
  await receive(capped.purchaseLineId, cappedMaterial.id, 4);
  const rowsBefore = await receiptLineCount(capped.purchaseLineId);
  const auditsBefore = await rejectAuditCount(capped.purchaseLineId);
  const progressBefore = await lineProgress(capped.purchaseLineId, 5);
  const stateBefore = (await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state;
  assert.equal(progressBefore.processedQty, 4);
  assert.equal(progressBefore.remainingQty, 1);

  await assert.rejects(
    reject(capped.purchaseLineId, 2),
    /累计处理数量将超过采购基础数量 5/,
  );
  assert.equal(await receiptLineCount(capped.purchaseLineId), rowsBefore);
  assert.equal(await rejectAuditCount(capped.purchaseLineId), auditsBefore);
  assert.deepEqual(await lineProgress(capped.purchaseLineId, 5), progressBefore);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state, stateBefore);
  assert.equal(await db.inventoryBatch.count({
    where: { storeId, materialId: cappedMaterial.id },
  }), 1);

  const exact = await reject(capped.purchaseLineId, 1);
  assert.equal(exact.progress.rejectedQty, 1);
  assert.equal(exact.progress.processedQty, 5);
  assert.equal(exact.progress.remainingQty, 0);
  assert.equal(exact.progress.state, "RECEIVED");
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state, PurchaseState.RECEIVED);

  // 5) A same-key rejection retry returns the same effect and writes one line/audit.
  const idempotentMaterial = await createMaterial("idempotent");
  const idempotent = await createPurchase(idempotentMaterial, 5);
  const idempotentKey = `IDEMPOTENT-REJECT-${marker}`;
  const first = await reject(idempotent.purchaseLineId, 2, "包装破损", {
    key: idempotentKey,
  });
  const retry = await reject(idempotent.purchaseLineId, 2, "包装破损", {
    key: idempotentKey,
  });
  assert.equal(retry.receiptId, first.receiptId);
  assert.equal(retry.purchaseState, first.purchaseState);
  assert.deepEqual(retry.progress, first.progress);
  assert.equal(await receiptLineCount(idempotent.purchaseLineId), 1);
  assert.equal(await rejectAuditCount(idempotent.purchaseLineId), 1);
  assert.equal(await db.inventoryBatch.count({
    where: { storeId, materialId: idempotentMaterial.id },
  }), 0);
  await assert.rejects(
    reject(idempotent.purchaseLineId, 3, "包装破损", { key: idempotentKey }),
    /幂等/,
  );
  assert.equal(await receiptLineCount(idempotent.purchaseLineId), 1);
  assert.equal(await rejectAuditCount(idempotent.purchaseLineId), 1);

  // 6) Concurrent same-line rejections cannot over-process; one must fail.
  const concurrentMaterial = await createMaterial("concurrent");
  const concurrent = await createPurchase(concurrentMaterial, 5);
  const race = await Promise.allSettled([
    reject(concurrent.purchaseLineId, 3, "并发拒收 A", {
      key: `RACE-REJECT-A-${marker}`,
    }),
    reject(concurrent.purchaseLineId, 3, "并发拒收 B", {
      key: `RACE-REJECT-B-${marker}`,
    }),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  const raceRejection = race.find((result) => result.status === "rejected");
  assert.ok(raceRejection && raceRejection.status === "rejected");
  assert.match(String(raceRejection.reason), /累计处理数量将超过采购基础数量 5/);
  const raceProgress = await lineProgress(concurrent.purchaseLineId, 5);
  assert.ok(raceProgress.processedQty <= 5);
  assert.equal(raceProgress.processedQty, 3);
  assert.equal(await receiptLineCount(concurrent.purchaseLineId), 1);
  assert.equal(await rejectAuditCount(concurrent.purchaseLineId), 1);

  // 7) Tenant or store mismatch is rejected before writing.
  const isolatedMaterial = await createMaterial("isolated");
  const isolated = await createPurchase(isolatedMaterial, 4);
  await assert.rejects(
    reject(isolated.purchaseLineId, 1, "错误租户", {
      tenantId: crypto.randomUUID(),
      key: `WRONG-TENANT-${marker}`,
    }),
    /不属于当前门店/,
  );
  const otherStore = await db.store.create({
    data: { tenantId, code: `SECOND-${marker}`, name: "拒收测试另一门店" },
  });
  await assert.rejects(
    reject(isolated.purchaseLineId, 1, "错误门店", {
      storeId: otherStore.id,
      key: `WRONG-STORE-${marker}`,
    }),
    /不属于当前门店/,
  );
  assert.equal(await receiptLineCount(isolated.purchaseLineId), 0);
  assert.equal(await rejectAuditCount(isolated.purchaseLineId), 0);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: isolated.purchaseOrderId },
  })).state, PurchaseState.ORDERED);

  // 8) A linked order receives ORDER_PURCHASE_REJECTED feedback without any order mutation.
  const linkedMaterial = await createMaterial("linked");
  const linked = await createPurchase(linkedMaterial, 3);
  const linkedOrderId = await createLinkedOrder(linked.purchaseLineId, linkedMaterial.id);
  const linkedOrderBefore = await db.order.findUniqueOrThrow({
    where: { id: linkedOrderId },
  });
  const linkedRejection = await reject(linked.purchaseLineId, 1, "批次磕碰", {
    key: `LINKED-REJECT-${marker}`,
  });
  assert.equal(linkedRejection.purchaseState, "PARTIALLY_RECEIVED");
  assert.equal(linkedRejection.progress.remainingQty, 2);

  const purchaseLineAudits = await db.auditEvent.findMany({
    where: {
      action: "PURCHASE_LINE_REJECTED",
      entityType: "PurchaseOrderLine",
      entityId: linked.purchaseLineId,
    },
  });
  assert.equal(purchaseLineAudits.length, 1);
  const lineAudit = purchaseLineAudits[0];
  assert.equal(lineAudit.tenantId, tenantId);
  assert.equal(lineAudit.storeId, storeId);
  assert.equal(lineAudit.actorStaffId, `staff-${marker}`);
  const lineAfter = lineAudit.afterSnapshot as unknown as {
    reason?: string;
    rejectedQty?: number;
    remainingQty?: number;
    purchaseState?: string;
    idempotencyKey?: string;
  };
  assert.equal(lineAfter.reason, "批次磕碰");
  assert.equal(lineAfter.rejectedQty, 1);
  assert.equal(lineAfter.remainingQty, 2);
  assert.equal(lineAfter.purchaseState, "PARTIALLY_RECEIVED");
  assert.equal(lineAfter.idempotencyKey, `LINKED-REJECT-${marker}`);

  const orderAudits = await db.auditEvent.findMany({
    where: {
      action: "ORDER_PURCHASE_REJECTED",
      entityType: "Order",
      entityId: linkedOrderId,
    },
  });
  assert.equal(orderAudits.length, 1);
  const orderAudit = orderAudits[0];
  assert.equal(orderAudit.tenantId, tenantId);
  assert.equal(orderAudit.storeId, storeId);
  assert.equal(orderAudit.actorStaffId, `staff-${marker}`);
  const orderAfter = orderAudit.afterSnapshot as unknown as {
    orderId?: string;
    purchaseOrderNumber?: string;
    purchaseLineId?: string;
    quantity?: number;
    reason?: string;
    purchaseState?: string;
    remainingQty?: number;
    expectedBaseQty?: number;
    processedQty?: number;
    summary?: string;
  };
  assert.equal(orderAfter.orderId, linkedOrderId);
  assert.equal(orderAfter.purchaseOrderNumber, (await db.purchaseOrder.findUniqueOrThrow({
    where: { id: linked.purchaseOrderId },
  })).number);
  assert.equal(orderAfter.purchaseLineId, linked.purchaseLineId);
  assert.equal(orderAfter.quantity, 1);
  assert.equal(orderAfter.reason, "批次磕碰");
  assert.equal(orderAfter.purchaseState, "PARTIALLY_RECEIVED");
  assert.equal(orderAfter.remainingQty, 2);
  assert.equal(orderAfter.expectedBaseQty, 3);
  assert.equal(orderAfter.processedQty, 1);
  assert.match(orderAfter.summary ?? "", /拒收 1支：批次磕碰；关联订单仍缺料时请重新采购或人工替换/);

  // Idempotent retry keeps exactly one purchase-line audit and one linked-order audit.
  const linkedRetry = await reject(linked.purchaseLineId, 1, "批次磕碰", {
    key: `LINKED-REJECT-${marker}`,
  });
  assert.equal(linkedRetry.receiptId, linkedRejection.receiptId);
  assert.equal(await rejectAuditCount(linked.purchaseLineId), 1);
  assert.equal(await db.auditEvent.count({
    where: {
      action: "ORDER_PURCHASE_REJECTED",
      entityType: "Order",
      entityId: linkedOrderId,
    },
  }), 1);

  const linkedOrderAfter = await db.order.findUniqueOrThrow({
    where: { id: linkedOrderId },
  });
  assert.equal(linkedOrderAfter.commercialState, linkedOrderBefore.commercialState);
  assert.equal(linkedOrderAfter.supplyState, linkedOrderBefore.supplyState);
  assert.equal(linkedOrderAfter.productionState, linkedOrderBefore.productionState);
  assert.equal(linkedOrderAfter.fulfillmentState, linkedOrderBefore.fulfillmentState);
  assert.equal(linkedOrderAfter.version, linkedOrderBefore.version);

  console.log("v2 reject-purchase-line tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.inventoryReservation.deleteMany({
    where: { requirement: { orderItem: { order: tenants } } },
  });
  await db.purchaseDemandAllocation.deleteMany({
    where: { requirement: { orderItem: { order: tenants } } },
  });
  await db.purchaseDemandAllocation.deleteMany({
    where: { purchaseLine: { purchaseOrder: tenants } },
  });
  await db.orderMaterialRequirement.deleteMany({
    where: { orderItem: { order: tenants } },
  });
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
      console.error("reject-purchase-line cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
