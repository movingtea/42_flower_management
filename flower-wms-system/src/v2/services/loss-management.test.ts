import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, LossReason, MaterialKind, OrderEntry, OrderItemKind, PrismaClient,
  TransactionKind,
} from "../../generated/prisma-v2/client";
import {
  recordLoss, reviewUnknownBatchLoss, submitUnknownBatchLoss, type RecordLossInput,
} from "./loss-management";
import { adjustInventory, type InventoryOperationScope } from "./inventory-operations";
import { auditRollbackError, failAfterAudit } from "./test-audit-rollback";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("V2_DATABASE_URL or DATABASE_URL is required for loss-management tests");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const tenantIds: string[] = [];

function scopeOf(tenantId: string, storeId: string): InventoryOperationScope {
  return { tenantId, storeId, actorStaffId: "staff-loss-test" };
}

function newKey(label: string): string {
  return `${label}-${marker}-${crypto.randomUUID()}`;
}

async function record(
  scope: InventoryOperationScope,
  input: RecordLossInput,
) {
  return db.$transaction((tx) => recordLoss(tx, scope, input));
}

async function balanceQty(batchId: string, locationId: string): Promise<number> {
  const balance = await db.batchBalance.findUnique({
    where: { batchId_locationId: { batchId, locationId } },
  });
  return Number(balance?.onHandQty ?? 0);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `v2-loss-${marker}`, name: "V2 损耗测试租户" },
  });
  tenantIds.push(tenant.id);
  const otherTenant = await db.tenant.create({
    data: { slug: `v2-loss-other-${marker}`, name: "V2 损耗另一租户" },
  });
  tenantIds.push(otherTenant.id);
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: `MAIN-${marker}`, name: "损耗测试店" },
  });
  const reviewer = await db.staffUser.create({ data: {
    username: `loss-reviewer-${marker}`, passwordHash: "test-only",
    tenantMembers: { create: { tenantId: tenant.id, roles: ["MANAGER"] } },
    storeMembers: { create: { storeId: store.id, roles: ["MANAGER"] } },
  } });
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: `OTHER-${marker}`, name: "损耗另一门店" },
  });
  const locationA = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `A-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  const locationB = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `B-${marker}`, kind: LocationKind.PRODUCTION },
  });
  const locationOtherStore = await db.inventoryLocation.create({
    data: { storeId: otherStore.id, code: `C-${marker}`, kind: LocationKind.WAREHOUSE },
  });

  const material = await db.material.create({
    data: {
      tenantId: tenant.id,
      code: `MAT-${marker}`,
      name: "损耗测试花材",
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 2,
    },
  });

  async function createBatch(label: string, storeId = store.id) {
    return db.inventoryBatch.create({
      data: { storeId, materialId: material.id, batchNo: `${label}-${marker}`, unitCost: 1 },
    });
  }

  const batchMain = await createBatch("MAIN");
  await db.batchBalance.create({
    data: {
      batchId: batchMain.id,
      locationId: locationA.id,
      onHandQty: 10,
      frozenQty: 2,
    },
  });
  const batchFrozen = await createBatch("FROZEN");
  await db.batchBalance.createMany({
    data: [
      { batchId: batchFrozen.id, locationId: locationA.id, onHandQty: 5, frozenQty: 1.5 },
      { batchId: batchFrozen.id, locationId: locationB.id, onHandQty: 5, frozenQty: 0 },
    ],
  });
  const batchReserved = await createBatch("RESERVED");
  await db.batchBalance.create({
    data: { batchId: batchReserved.id, locationId: locationA.id, onHandQty: 5 },
  });
  const batchOtherStore = await createBatch("OTHER-STORE", otherStore.id);
  await db.batchBalance.create({
    data: { batchId: batchOtherStore.id, locationId: locationOtherStore.id, onHandQty: 20 },
  });

  // An active reservation makes 4 of the 5 units unavailable.
  const order = await db.order.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      number: `ORD-${marker}`,
      createdVia: OrderEntry.STAFF_PORTAL,
      sourceChannel: "TEST",
    },
  });
  const orderItem = await db.orderItem.create({
    data: {
      orderId: order.id,
      kind: OrderItemKind.STANDARD,
      nameSnapshot: "损耗预留测试",
      quantity: 1,
      unitPrice: 0,
    },
  });
  const revision = await db.orderRevision.create({
    data: { orderId: order.id, number: 1 },
  });
  const requirement = await db.orderMaterialRequirement.create({
    data: {
      orderItemId: orderItem.id,
      revisionId: revision.id,
      materialId: material.id,
      plannedQty: 4,
      needBy: new Date(Date.now() + 86_400_000),
    },
  });
  await db.inventoryReservation.create({
    data: { requirementId: requirement.id, batchId: batchReserved.id, quantity: 4 },
  });

  const scope = scopeOf(tenant.id, store.id);
  const occurredAt = new Date("2026-11-06T08:00:00.000Z");

  // Success: LossRecord + LOSS movement + audit, and the chosen balance is decremented.
  const lossKey = newKey("LOSS-OK");
  const lossInput: RecordLossInput = {
    batchId: batchMain.id,
    locationId: locationA.id,
    quantity: 3,
    reason: LossReason.CARE_DAMAGE,
    note: "花头压伤",
    occurredAt,
    idempotencyKey: lossKey,
  };
  const loss = await record(scope, lossInput);
  assert.equal(loss.idempotent, false);
  assert.equal(loss.quantity, 3);
  assert.equal(loss.baseUnit, "支");
  assert.equal(loss.reason, LossReason.CARE_DAMAGE);
  assert.equal(loss.locationOnHand, 7);
  assert.equal(loss.batchAvailableQty, 5);
  assert.equal(await balanceQty(batchMain.id, locationA.id), 7);

  const lossRecord = await db.lossRecord.findUniqueOrThrow({
    where: { id: loss.lossRecordId },
  });
  assert.equal(lossRecord.storeId, store.id);
  assert.equal(lossRecord.batchId, batchMain.id);
  assert.equal(lossRecord.reason, LossReason.CARE_DAMAGE);
  assert.equal(Number(lossRecord.quantity), 3);
  assert.equal(lossRecord.note, "花头压伤");
  assert.equal(lossRecord.occurredAt.getTime(), occurredAt.getTime());

  const lossTransaction = await db.inventoryTransaction.findUniqueOrThrow({
    where: { idempotencyKey: lossKey },
  });
  assert.equal(lossTransaction.kind, TransactionKind.LOSS);
  assert.equal(lossTransaction.batchId, batchMain.id);
  assert.equal(lossTransaction.fromLocationId, locationA.id);
  assert.equal(lossTransaction.toLocationId, null);
  assert.equal(lossTransaction.referenceType, "LOSS_RECORD");
  assert.equal(lossTransaction.referenceId, lossRecord.id);
  assert.equal(Number(lossTransaction.quantity), 3);
  assert.equal(await db.auditEvent.count({
    where: { entityId: lossRecord.id, action: "LOSS_RECORDED" },
  }), 1);

  const lossRetry = await record(scope, lossInput);
  assert.equal(lossRetry.idempotent, true);
  assert.equal(lossRetry.lossRecordId, loss.lossRecordId);
  assert.equal(lossRetry.transactionId, lossTransaction.id);
  assert.equal(lossRetry.locationOnHand, 7);
  assert.equal(lossRetry.batchAvailableQty, 5);
  assert.equal(await balanceQty(batchMain.id, locationA.id), 7);
  assert.equal(await db.lossRecord.count({ where: { storeId: store.id } }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: lossRecord.id, action: "LOSS_RECORDED" },
  }), 1);

  await assert.rejects(
    record(scope, { ...lossInput, note: "另一个备注" }),
    /幂等键/,
  );
  await assert.rejects(
    record(scope, { ...lossInput, quantity: 2 }),
    /幂等键/,
  );
  await assert.rejects(
    record(scope, { ...lossInput, occurredAt: new Date("2026-11-07T08:00:00.000Z") }),
    /幂等键/,
  );
  assert.equal(await balanceQty(batchMain.id, locationA.id), 7);

  // An omitted occurredAt defaults to now, and a retry that also omits it still matches.
  const defaultTimeKey = newKey("LOSS-DEFAULT-TIME");
  const defaultTimeLoss = await record(scope, {
    batchId: batchMain.id,
    locationId: locationA.id,
    quantity: 0.5,
    reason: LossReason.EXPIRED,
    idempotencyKey: defaultTimeKey,
  });
  const defaultTimeRetry = await record(scope, {
    batchId: batchMain.id,
    locationId: locationA.id,
    quantity: 0.5,
    reason: LossReason.EXPIRED,
    idempotencyKey: defaultTimeKey,
  });
  assert.equal(defaultTimeRetry.idempotent, true);
  assert.equal(defaultTimeRetry.lossRecordId, defaultTimeLoss.lossRecordId);
  const defaultTimeRecord = await db.lossRecord.findUniqueOrThrow({
    where: { id: defaultTimeLoss.lossRecordId },
  });
  assert.ok(defaultTimeRecord.occurredAt.getTime() <= Date.now());

  // Available bounds: batch availability, location availability and active reservations.
  await assert.rejects(
    record(scope, {
      batchId: batchMain.id,
      locationId: locationA.id,
      quantity: 5.01,
      reason: LossReason.CARE_DAMAGE,
      idempotencyKey: newKey("LOSS-OVER-BATCH"),
    }),
    /可用库存/,
  );
  assert.equal(await balanceQty(batchMain.id, locationA.id), 6.5);

  await assert.rejects(
    record(scope, {
      batchId: batchFrozen.id,
      locationId: locationA.id,
      quantity: 4,
      reason: LossReason.CARE_DAMAGE,
      idempotencyKey: newKey("LOSS-OVER-LOCATION"),
    }),
    /可用库存/,
  );
  assert.equal(await balanceQty(batchFrozen.id, locationA.id), 5);
  const frozenLoss = await record(scope, {
    batchId: batchFrozen.id,
    locationId: locationA.id,
    quantity: 3.5,
    reason: LossReason.CARE_DAMAGE,
    idempotencyKey: newKey("LOSS-LOCATION-BOUND"),
  });
  assert.equal(frozenLoss.locationOnHand, 1.5);
  assert.equal(frozenLoss.batchAvailableQty, 5);

  await assert.rejects(
    record(scope, {
      batchId: batchReserved.id,
      locationId: locationA.id,
      quantity: 1.5,
      reason: LossReason.EXPIRED,
      idempotencyKey: newKey("LOSS-OVER-RESERVED"),
    }),
    /可用库存/,
  );
  assert.equal(await balanceQty(batchReserved.id, locationA.id), 5);
  const reservedLoss = await record(scope, {
    batchId: batchReserved.id,
    locationId: locationA.id,
    quantity: 1,
    reason: LossReason.EXPIRED,
    idempotencyKey: newKey("LOSS-RESERVED-BOUND"),
  });
  assert.equal(reservedLoss.locationOnHand, 4);
  assert.equal(reservedLoss.batchAvailableQty, 0);

  // Reason validation.
  await assert.rejects(
    record(scope, {
      batchId: batchMain.id,
      locationId: locationA.id,
      quantity: 1,
      reason: "NOT_A_REASON" as LossReason,
      idempotencyKey: newKey("LOSS-BAD-REASON"),
    }),
    /损耗原因/,
  );
  await assert.rejects(
    record(scope, {
      batchId: batchMain.id,
      locationId: locationA.id,
      quantity: 1,
      reason: undefined as unknown as LossReason,
      idempotencyKey: newKey("LOSS-MISSING-REASON"),
    }),
    /损耗原因/,
  );

  // Quantity validation.
  for (const [quantity, pattern] of [
    [0, /大于零/],
    [-1, /大于零/],
    [Number.NaN, /有限/],
    [Number.POSITIVE_INFINITY, /有限/],
    [0.001, /计量精度/],
  ] as const) {
    await assert.rejects(
      record(scope, {
        batchId: batchMain.id,
        locationId: locationA.id,
        quantity,
        reason: LossReason.OTHER,
        idempotencyKey: newKey("LOSS-BAD-QTY"),
      }),
      pattern,
    );
  }

  // Cross-store and cross-tenant references are rejected without writing.
  await assert.rejects(
    record(scope, {
      batchId: batchOtherStore.id,
      locationId: locationA.id,
      quantity: 1,
      reason: LossReason.OTHER,
      idempotencyKey: newKey("LOSS-CROSS-BATCH"),
    }),
    /库存批次.*不属于当前门店/,
  );
  await assert.rejects(
    record(scope, {
      batchId: batchMain.id,
      locationId: locationOtherStore.id,
      quantity: 1,
      reason: LossReason.OTHER,
      idempotencyKey: newKey("LOSS-CROSS-LOC"),
    }),
    /库位.*不属于当前门店/,
  );
  await assert.rejects(
    record(scopeOf(otherTenant.id, store.id), {
      batchId: batchMain.id,
      locationId: locationA.id,
      quantity: 1,
      reason: LossReason.OTHER,
      idempotencyKey: newKey("LOSS-CROSS-TENANT"),
    }),
    /门店.*不属于当前租户/,
  );
  await assert.rejects(
    record(scopeOf(tenant.id, otherStore.id), {
      batchId: batchMain.id,
      locationId: locationA.id,
      quantity: 1,
      reason: LossReason.OTHER,
      idempotencyKey: newKey("LOSS-CROSS-STORE"),
    }),
    /库存批次.*不属于当前门店/,
  );

  // Exactly the successful losses were persisted; failed paths wrote nothing.
  assert.equal(await db.lossRecord.count({ where: { storeId: store.id } }), 4);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { storeId: store.id }, kind: TransactionKind.LOSS },
  }), 4);

  const rollbackBatch = await createBatch("ROLLBACK");
  await db.batchBalance.create({
    data: { batchId: rollbackBatch.id, locationId: locationA.id, onHandQty: 10 },
  });
  const rollbackInput = {
    ...lossInput,
    batchId: rollbackBatch.id,
    quantity: 4,
    idempotencyKey: newKey("LOSS-ROLLBACK"),
  };
  const auditFilter = { tenantId: tenant.id, storeId: store.id, action: "LOSS_RECORDED" };
  const auditsBefore = await db.auditEvent.count({ where: auditFilter });
  await assert.rejects(
    db.$transaction((tx) => recordLoss(failAfterAudit(tx, "LOSS_RECORDED"), scope, rollbackInput)),
    { message: auditRollbackError },
  );
  assert.equal(await balanceQty(rollbackBatch.id, locationA.id), 10);
  assert.equal(await db.lossRecord.count({ where: { batchId: rollbackBatch.id } }), 0);
  assert.equal(await db.inventoryTransaction.count({ where: { batchId: rollbackBatch.id } }), 0);
  assert.equal(await db.auditEvent.count({ where: auditFilter }), auditsBefore);
  await record(scope, rollbackInput);
  assert.equal(await balanceQty(rollbackBatch.id, locationA.id), 6);

  const raceBatch = await createBatch("CONCURRENT");
  await db.batchBalance.create({
    data: { batchId: raceBatch.id, locationId: locationA.id, onHandQty: 10 },
  });
  const [lossRace, adjustmentRace] = await Promise.allSettled([
    record(scope, {
      ...lossInput,
      batchId: raceBatch.id,
      quantity: 7,
      idempotencyKey: newKey("LOSS-CONCURRENT"),
    }),
    db.$transaction((tx) => adjustInventory(tx, scope, {
      batchId: raceBatch.id,
      locationId: locationA.id,
      mode: "DECREASE",
      quantity: 7,
      reason: "并发调整",
      idempotencyKey: newKey("ADJUST-CONCURRENT"),
    })),
  ]);
  assert.notEqual(lossRace.status, adjustmentRace.status);
  assert.equal(await balanceQty(raceBatch.id, locationA.id), 3);
  const movements = await db.inventoryTransaction.findMany({ where: { batchId: raceBatch.id } });
  assert.equal(movements.length, 1);
  assert.equal(Number(movements[0].quantity), 7);
  assert.equal(movements[0].kind, lossRace.status === "fulfilled" ? TransactionKind.LOSS : TransactionKind.ADJUSTMENT);
  assert.equal(await db.lossRecord.count({ where: { batchId: raceBatch.id } }), lossRace.status === "fulfilled" ? 1 : 0);

  const unknownBatch = await createBatch("UNKNOWN-REVIEW");
  await db.batchBalance.create({ data: { batchId: unknownBatch.id, locationId: locationA.id, onHandQty: 5 } });
  const pending = await db.$transaction((tx) => submitUnknownBatchLoss(tx, scope, {
    materialId: material.id, locationId: locationA.id, quantity: 2,
    reason: LossReason.OTHER, note: "现场无法确认批次", idempotencyKey: newKey("UNKNOWN"),
  }));
  assert.equal(await balanceQty(unknownBatch.id, locationA.id), 5);
  const pendingRecord = await db.lossRecord.findUniqueOrThrow({ where: { id: pending.lossRecordId } });
  assert.equal(pendingRecord.pendingBatchVerification, true);
  assert.equal(pendingRecord.reviewStatus, "PENDING");
  const review = await db.$transaction((tx) => reviewUnknownBatchLoss(tx, {
    tenantId: tenant.id, storeId: store.id, actorStaffId: reviewer.id,
  }, { lossRecordId: pending.lossRecordId, decision: "APPROVE", batchId: unknownBatch.id, note: "现场复核批次" }));
  assert.equal(review.approved, true);
  assert.equal(await balanceQty(unknownBatch.id, locationA.id), 3);
  const approvedRecord = await db.lossRecord.findUniqueOrThrow({ where: { id: pending.lossRecordId } });
  assert.equal(approvedRecord.batchId, unknownBatch.id);
  assert.equal(approvedRecord.reviewStatus, "APPROVED");

  console.log("v2 loss-management tests passed");
}

async function cleanup() {
  if (tenantIds.length === 0) return;
  const tenantFilter = { tenantId: { in: tenantIds } };
  const storeFilter = { store: { tenantId: { in: tenantIds } } };
  await db.auditEvent.deleteMany({ where: tenantFilter });
  await db.inventoryTransaction.deleteMany({ where: { batch: storeFilter } });
  await db.lossRecord.deleteMany({ where: storeFilter });
  await db.inventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.sampleInventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenantFilter } } });
  await db.orderItem.deleteMany({ where: { order: tenantFilter } });
  await db.orderRevision.deleteMany({ where: { order: tenantFilter } });
  await db.order.deleteMany({ where: tenantFilter });
  await db.batchBalance.deleteMany({ where: { batch: storeFilter } });
  await db.inventoryBatch.deleteMany({ where: storeFilter });
  await db.material.deleteMany({ where: tenantFilter });
  await db.inventoryLocation.deleteMany({ where: storeFilter });
  await db.storeMember.deleteMany({ where: { store: { tenantId: { in: tenantIds } } } });
  await db.tenantMember.deleteMany({ where: tenantFilter });
  await db.store.deleteMany({ where: tenantFilter });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.staffUser.deleteMany({ where: { username: { startsWith: "loss-reviewer-" } } });
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
      console.error("loss-management cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
