import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, MaterialKind, PrismaClient, PurchaseState,
} from "../../generated/prisma-v2-draft/client";
import { calculatePurchaseProgress } from "../domain/purchase-progress";
import { receivePurchaseLine } from "./receive-purchase-line";
import { rejectPurchaseLine } from "./reject-purchase-line";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for receipt tests");
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
      name: `${label} 收货测试花材`,
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
      name: `收货测试供应商 ${suffix}`,
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

type ReceiveOptions = {
  key?: string;
  tenantId?: string;
  locationId?: string;
  disposition?: "ACCEPTED" | "DOWNGRADED";
  reason?: string;
};

async function receive(
  lineId: string,
  acceptedMaterialId: string,
  quantity: number,
  options: ReceiveOptions = {},
): Promise<string> {
  assert.ok(tenantId && warehouseId);
  return db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: options.tenantId ?? tenantId!,
    actorStaffId: `staff-${marker}`,
    purchaseLineId: lineId,
    locationId: options.locationId ?? warehouseId!,
    acceptedMaterialId,
    quantity,
    batchNo: `B-${marker}-${crypto.randomUUID().slice(0, 6)}`,
    disposition: options.disposition ?? "ACCEPTED",
    gradeChangeReason: options.reason,
    finalUnitCost: 1,
    idempotencyKey: options.key ?? `RECEIPT-${marker}-${crypto.randomUUID()}`,
  }));
}

async function reject(
  lineId: string,
  quantity: number,
  reason = "花头损坏",
  key = `REJECT-${marker}-${crypto.randomUUID()}`,
) {
  assert.ok(tenantId && storeId);
  return db.$transaction((tx) => rejectPurchaseLine(tx, {
    tenantId: tenantId!,
    storeId: storeId!,
    purchaseLineId: lineId,
    quantity,
    reason,
    actorStaffId: `staff-${marker}`,
    idempotencyKey: key,
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

async function receiveAuditCount(lineId: string): Promise<number> {
  return db.auditEvent.count({
    where: {
      action: "PURCHASE_LINE_RECEIVED",
      entityType: "PurchaseOrderLine",
      entityId: lineId,
    },
  });
}

async function main() {
  const tenant = await db.tenant.create({
    data: {
      slug: `phase1-receive-${marker}`,
      name: "Phase 1 收货测试租户",
    },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 收货测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;

  // 1) Four ordered: downgrade one to another material, then accept the remaining three.
  const original = await createMaterial("original");
  const replacement = await createMaterial("replacement");
  const split = await createPurchase(original, 4);
  const downgradedBatchId = await receive(
    split.purchaseLineId, replacement.id, 1,
    { disposition: "DOWNGRADED", reason: "花头等级不足，降级入库" },
  );
  const downgradedOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: split.purchaseOrderId },
  });
  assert.equal(downgradedOrder.state, PurchaseState.PARTIALLY_RECEIVED);

  const acceptedBatchId = await receive(split.purchaseLineId, original.id, 3);
  assert.notEqual(acceptedBatchId, downgradedBatchId);
  const splitBatches = await db.inventoryBatch.findMany({
    where: { id: { in: [downgradedBatchId, acceptedBatchId] } },
    include: { balances: true, transactions: true },
  });
  assert.equal(splitBatches.length, 2);
  const downgradedBatch = splitBatches.find((batch) => batch.id === downgradedBatchId);
  const acceptedBatch = splitBatches.find((batch) => batch.id === acceptedBatchId);
  assert.ok(downgradedBatch && acceptedBatch);
  assert.equal(downgradedBatch.materialId, replacement.id);
  assert.equal(acceptedBatch.materialId, original.id);
  assert.equal(
    downgradedBatch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
    1,
  );
  assert.equal(
    acceptedBatch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
    3,
  );
  assert.equal(downgradedBatch.transactions.length, 1);
  assert.equal(acceptedBatch.transactions.length, 1);

  const splitProgress = await lineProgress(split.purchaseLineId, 4);
  assert.deepEqual(splitProgress, {
    acceptedOriginalQty: 3,
    downgradedQty: 1,
    rejectedQty: 0,
    processedQty: 4,
    remainingQty: 0,
    state: "RECEIVED",
    hasRejection: false,
  });
  const splitOrder = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: split.purchaseOrderId },
  });
  assert.equal(splitOrder.state, PurchaseState.RECEIVED);
  assert.equal(await receiveAuditCount(split.purchaseLineId), 2);
  const splitAudits = await db.auditEvent.findMany({
    where: {
      action: "PURCHASE_LINE_RECEIVED",
      entityType: "PurchaseOrderLine",
      entityId: split.purchaseLineId,
    },
  });
  const downgradeAudit = splitAudits.find((audit) => {
    const snapshot = audit.afterSnapshot as unknown as { disposition?: string } | null;
    return snapshot?.disposition === "DOWNGRADED";
  });
  assert.ok(downgradeAudit);
  const downgradeSnapshot = downgradeAudit.afterSnapshot as unknown as {
    batchId?: string;
    batchNo?: string;
    expectedBaseQty?: number;
    purchaseState?: string;
    idempotencyKey?: string;
  };
  assert.equal(downgradeSnapshot.batchId, downgradedBatchId);
  assert.ok(downgradeSnapshot.batchNo?.startsWith(`B-${marker}`));
  assert.equal(downgradeSnapshot.expectedBaseQty, 4);
  assert.equal(downgradeSnapshot.purchaseState, "PARTIALLY_RECEIVED");
  assert.ok(downgradeSnapshot.idempotencyKey);

  // 2) Rejection after acceptance cannot exceed the expected quantity and writes nothing on failure.
  const capped = await createPurchase(original, 4);
  await receive(capped.purchaseLineId, original.id, 3);
  const failedRowsBefore = await receiptLineCount(capped.purchaseLineId);
  const failedBatchesBefore = await db.inventoryBatch.count({
    where: { storeId, materialId: original.id },
  });
  const failedTransactionsBefore = await db.inventoryTransaction.count({
    where: { batch: { storeId, materialId: original.id } },
  });
  const failedProgressBefore = await lineProgress(capped.purchaseLineId, 4);
  const failedStateBefore = (await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state;

  await assert.rejects(
    reject(capped.purchaseLineId, 2),
    /累计处理数量将超过采购基础数量 4/,
  );
  assert.equal(await receiptLineCount(capped.purchaseLineId), failedRowsBefore);
  assert.equal(
    await db.inventoryBatch.count({ where: { storeId, materialId: original.id } }),
    failedBatchesBefore,
  );
  assert.equal(
    await db.inventoryTransaction.count({ where: { batch: { storeId, materialId: original.id } } }),
    failedTransactionsBefore,
  );
  assert.deepEqual(await lineProgress(capped.purchaseLineId, 4), failedProgressBefore);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state, failedStateBefore);
  assert.equal(failedProgressBefore.processedQty, 3);
  assert.equal(failedProgressBefore.remainingQty, 1);

  // The exact remaining quantity is still allowed and completes the line with a rejection.
  const exactRejection = await reject(capped.purchaseLineId, 1);
  assert.equal(exactRejection.progress.state, "RECEIVED");
  assert.equal(exactRejection.progress.rejectedQty, 1);
  assert.equal(exactRejection.progress.remainingQty, 0);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: capped.purchaseOrderId },
  })).state, PurchaseState.RECEIVED);

  // 3) All-rejected lines complete the purchase without creating inventory.
  const allRejected = await createPurchase(original, 2);
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
    where: { storeId, materialId: original.id },
  }), 2); // only the two accepted/downgraded batches from scenario 1
  assert.equal(await db.inventoryBatch.count({
    where: { storeId, materialId: original.id, receiptLine: { purchaseLineId: allRejected.purchaseLineId } },
  }), 0);
  assert.equal(await db.batchBalance.count({
    where: { batch: { materialId: original.id, receiptLine: { purchaseLineId: allRejected.purchaseLineId } } },
  }), 0);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { materialId: original.id, receiptLine: { purchaseLineId: allRejected.purchaseLineId } } },
  }), 0);

  // 4) Invalid rejection quantity/reason leaves the line untouched.
  const invalid = await createPurchase(original, 5);
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(reject(invalid.purchaseLineId, quantity), /拒收数量/);
  }
  for (const reason of ["", "   "]) {
    await assert.rejects(reject(invalid.purchaseLineId, 1, reason), /拒收原因/);
  }
  assert.equal(await receiptLineCount(invalid.purchaseLineId), 0);
  assert.equal(await receiveAuditCount(invalid.purchaseLineId), 0);
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

  // 5) A same-key receive retry returns the same batch and writes one line/audit/movement.
  const idempotent = await createPurchase(original, 5);
  const idempotentKey = `IDEMPOTENT-RECEIVE-${marker}`;
  const firstBatchId = await receive(
    idempotent.purchaseLineId, original.id, 2, { key: idempotentKey },
  );
  const secondBatchId = await receive(
    idempotent.purchaseLineId, original.id, 2, { key: idempotentKey },
  );
  assert.equal(secondBatchId, firstBatchId);
  assert.equal(await receiptLineCount(idempotent.purchaseLineId), 1);
  assert.equal(await receiveAuditCount(idempotent.purchaseLineId), 1);
  assert.equal(await db.inventoryBatch.count({
    where: { storeId, materialId: original.id, receiptLine: { purchaseLineId: idempotent.purchaseLineId } },
  }), 1);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { storeId, materialId: original.id, receiptLine: { purchaseLineId: idempotent.purchaseLineId } } },
  }), 1);
  await assert.rejects(
    receive(idempotent.purchaseLineId, original.id, 3, { key: idempotentKey }),
    /幂等/,
  );
  assert.equal(await receiptLineCount(idempotent.purchaseLineId), 1);
  assert.equal(await receiveAuditCount(idempotent.purchaseLineId), 1);

  // 6) Concurrent same-line receives cannot over-process; one must fail.
  const concurrent = await createPurchase(original, 5);
  const race = await Promise.allSettled([
    receive(concurrent.purchaseLineId, original.id, 4, {
      key: `RACE-RECEIVE-A-${marker}`,
    }),
    receive(concurrent.purchaseLineId, original.id, 4, {
      key: `RACE-RECEIVE-B-${marker}`,
    }),
  ]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  const raceRejection = race.find((result) => result.status === "rejected");
  assert.ok(raceRejection && raceRejection.status === "rejected");
  assert.match(String(raceRejection.reason), /累计处理数量将超过采购基础数量 5/);
  const raceProgress = await lineProgress(concurrent.purchaseLineId, 5);
  assert.ok(raceProgress.processedQty <= 5);
  assert.equal(raceProgress.processedQty, 4);
  assert.equal(await receiptLineCount(concurrent.purchaseLineId), 1);
  assert.equal(await receiveAuditCount(concurrent.purchaseLineId), 1);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: concurrent.purchaseOrderId },
  })).state, PurchaseState.PARTIALLY_RECEIVED);

  // 7) Wrong tenant or wrong store location is rejected before writing.
  const isolated = await createPurchase(original, 5);
  const isolatedRowsBefore = await receiptLineCount(isolated.purchaseLineId);
  const isolatedAuditBefore = await receiveAuditCount(isolated.purchaseLineId);
  await assert.rejects(
    receive(isolated.purchaseLineId, original.id, 1, {
      tenantId: crypto.randomUUID(),
      key: `WRONG-TENANT-${marker}`,
    }),
    /不属于当前租户/,
  );
  const otherStore = await db.store.create({
    data: { tenantId, code: `SECOND-${marker}`, name: "收货测试另一门店" },
  });
  const otherLocation = await db.inventoryLocation.create({
    data: { storeId: otherStore.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  await assert.rejects(
    receive(isolated.purchaseLineId, original.id, 1, {
      locationId: otherLocation.id,
      key: `WRONG-LOCATION-${marker}`,
    }),
    /收货库位不属于采购单门店/,
  );
  assert.equal(await receiptLineCount(isolated.purchaseLineId), isolatedRowsBefore);
  assert.equal(await receiveAuditCount(isolated.purchaseLineId), isolatedAuditBefore);
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({
    where: { id: isolated.purchaseOrderId },
  })).state, PurchaseState.ORDERED);

  console.log("v2 receive-purchase-line tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.inventoryReservation.deleteMany({ where: { batch: { store: tenants } } });
  await db.purchaseDemandAllocation.deleteMany({
    where: { purchaseLine: { purchaseOrder: tenants } },
  });
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
      console.error("receive-purchase-line cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
