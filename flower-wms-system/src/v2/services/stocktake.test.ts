import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, MaterialKind, PrismaClient, StocktakeState, TransactionKind,
} from "../../generated/prisma-v2-draft/client";
import {
  confirmStocktake, createStocktakeDraft,
  type CreateStocktakeDraftInput, type ConfirmStocktakeLineResult,
} from "./stocktake";
import type { InventoryOperationScope } from "./inventory-operations";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("V2_DATABASE_URL or DATABASE_URL is required for stocktake tests");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const tenantIds: string[] = [];

function scopeOf(tenantId: string, storeId: string): InventoryOperationScope {
  return { tenantId, storeId, actorStaffId: "staff-stocktake-test" };
}

function newKey(label: string): string {
  return `${label}-${marker}-${crypto.randomUUID()}`;
}

async function createDraft(
  scope: InventoryOperationScope,
  input: CreateStocktakeDraftInput,
) {
  return db.$transaction((tx) => createStocktakeDraft(tx, scope, input));
}

async function confirm(
  scope: InventoryOperationScope,
  stocktakeId: string,
) {
  return db.$transaction((tx) => confirmStocktake(tx, scope, stocktakeId));
}

async function balanceQty(batchId: string, locationId: string): Promise<number> {
  const balance = await db.batchBalance.findUnique({
    where: { batchId_locationId: { batchId, locationId } },
  });
  return Number(balance?.onHandQty ?? 0);
}

function lineOf(
  lines: ConfirmStocktakeLineResult[],
  batchId: string,
): ConfirmStocktakeLineResult {
  const line = lines.find((candidate) => candidate.batchId === batchId);
  if (!line) throw new Error(`missing confirmed line for ${batchId}`);
  return line;
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `v2-stocktake-${marker}`, name: "V2 盘点测试租户" },
  });
  tenantIds.push(tenant.id);
  const otherTenant = await db.tenant.create({
    data: { slug: `v2-stocktake-other-${marker}`, name: "V2 盘点另一租户" },
  });
  tenantIds.push(otherTenant.id);
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: `MAIN-${marker}`, name: "盘点测试店" },
  });
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: `OTHER-${marker}`, name: "盘点另一门店" },
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
      name: "盘点测试花材",
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

  const batchOne = await createBatch("ONE");
  await db.batchBalance.create({
    data: { batchId: batchOne.id, locationId: locationA.id, onHandQty: 10 },
  });
  const batchTwo = await createBatch("TWO");
  await db.batchBalance.create({
    data: { batchId: batchTwo.id, locationId: locationB.id, onHandQty: 5 },
  });
  const batchNoBalance = await createBatch("NO-BALANCE");
  const batchOtherStore = await createBatch("OTHER-STORE", otherStore.id);
  await db.batchBalance.create({
    data: { batchId: batchOtherStore.id, locationId: locationOtherStore.id, onHandQty: 20 },
  });
  const batchCancelled = await createBatch("CANCELLED");
  await db.batchBalance.create({
    data: { batchId: batchCancelled.id, locationId: locationA.id, onHandQty: 3 },
  });
  const batchZero = await createBatch("ZERO");
  await db.batchBalance.create({
    data: { batchId: batchZero.id, locationId: locationA.id, onHandQty: 2 },
  });

  const scope = scopeOf(tenant.id, store.id);

  // Draft snapshots current on hand and never changes inventory.
  const draftKey = newKey("ST-DRAFT");
  const draft = await createDraft(scope, {
    idempotencyKey: draftKey,
    lines: [
      { batchId: batchOne.id, locationId: locationA.id, countedQty: 8.5, reason: "盘点差异" },
      { batchId: batchTwo.id, locationId: locationB.id, countedQty: 5 },
      { batchId: batchNoBalance.id, locationId: locationB.id, countedQty: 2 },
    ],
  });
  assert.equal(draft.idempotent, false);
  assert.equal(draft.lineCount, 3);
  assert.equal(draft.totalRecordedQty, 15);
  assert.equal(draft.totalCountedQty, 15.5);
  assert.equal(draft.totalDifferenceQty, 0.5);

  const storedStocktake = await db.stocktake.findUniqueOrThrow({
    where: { id: draft.stocktakeId },
    include: { lines: { orderBy: { batchId: "asc" } } },
  });
  assert.equal(storedStocktake.state, StocktakeState.DRAFT);
  assert.equal(storedStocktake.confirmedAt, null);
  assert.equal(storedStocktake.lines.length, 3);
  const recordedByBatch = new Map(
    storedStocktake.lines.map((line) => [line.batchId, Number(line.recordedQty)]),
  );
  assert.equal(recordedByBatch.get(batchOne.id), 10);
  assert.equal(recordedByBatch.get(batchTwo.id), 5);
  assert.equal(recordedByBatch.get(batchNoBalance.id), 0);
  assert.equal(await balanceQty(batchOne.id, locationA.id), 10);
  assert.equal(await balanceQty(batchTwo.id, locationB.id), 5);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { storeId: store.id } },
  }), 0);
  assert.equal(await db.auditEvent.count({
    where: { entityId: draft.stocktakeId, action: "STOCKTAKE_DRAFT_CREATED" },
  }), 1);

  const draftRetry = await createDraft(scope, {
    idempotencyKey: draftKey,
    lines: [
      { batchId: batchOne.id, locationId: locationA.id, countedQty: 8.5, reason: "盘点差异" },
      { batchId: batchTwo.id, locationId: locationB.id, countedQty: 5 },
      { batchId: batchNoBalance.id, locationId: locationB.id, countedQty: 2 },
    ],
  });
  assert.equal(draftRetry.idempotent, true);
  assert.equal(draftRetry.stocktakeId, draft.stocktakeId);
  assert.equal(draftRetry.totalDifferenceQty, 0.5);
  assert.equal(await db.stocktake.count({ where: { storeId: store.id } }), 1);
  assert.equal(await db.stocktakeLine.count({ where: { stocktakeId: draft.stocktakeId } }), 3);
  assert.equal(await db.auditEvent.count({
    where: { entityId: draft.stocktakeId, action: "STOCKTAKE_DRAFT_CREATED" },
  }), 1);

  await assert.rejects(
    createDraft(scope, {
      idempotencyKey: draftKey,
      lines: [
        { batchId: batchOne.id, locationId: locationA.id, countedQty: 9 },
        { batchId: batchTwo.id, locationId: locationB.id, countedQty: 5 },
        { batchId: batchNoBalance.id, locationId: locationB.id, countedQty: 2 },
      ],
    }),
    /幂等键/,
  );

  // Structural and quantity validation.
  await assert.rejects(
    createDraft(scope, { idempotencyKey: newKey("ST-EMPTY"), lines: [] }),
    /1 到 100 行/,
  );
  await assert.rejects(
    createDraft(scope, {
      idempotencyKey: newKey("ST-MANY"),
      lines: Array.from({ length: 101 }, () => ({
        batchId: batchOne.id,
        locationId: locationA.id,
        countedQty: 1,
      })),
    }),
    /1 到 100 行/,
  );
  await assert.rejects(
    createDraft(scope, {
      idempotencyKey: newKey("ST-DUP"),
      lines: [
        { batchId: batchOne.id, locationId: locationA.id, countedQty: 1 },
        { batchId: batchOne.id, locationId: locationA.id, countedQty: 2 },
      ],
    }),
    /重复/,
  );
  for (const [countedQty, pattern] of [
    [-1, /负数/],
    [Number.NaN, /有限/],
    [Number.POSITIVE_INFINITY, /有限/],
    [0.001, /计量精度/],
  ] as const) {
    await assert.rejects(
      createDraft(scope, {
        idempotencyKey: newKey("ST-BAD-QTY"),
        lines: [{ batchId: batchOne.id, locationId: locationA.id, countedQty }],
      }),
      pattern,
    );
  }

  // Cross-store and cross-tenant references are rejected.
  await assert.rejects(
    createDraft(scope, {
      idempotencyKey: newKey("ST-CROSS-BATCH"),
      lines: [{ batchId: batchOtherStore.id, locationId: locationA.id, countedQty: 1 }],
    }),
    /库存批次.*不属于当前门店/,
  );
  await assert.rejects(
    createDraft(scope, {
      idempotencyKey: newKey("ST-CROSS-LOC"),
      lines: [{ batchId: batchOne.id, locationId: locationOtherStore.id, countedQty: 1 }],
    }),
    /库位.*不属于当前门店/,
  );
  await assert.rejects(
    createDraft(scopeOf(otherTenant.id, store.id), {
      idempotencyKey: newKey("ST-CROSS-TENANT"),
      lines: [{ batchId: batchOne.id, locationId: locationA.id, countedQty: 1 }],
    }),
    /门店.*不属于当前租户/,
  );
  await assert.rejects(
    createDraft(scopeOf(tenant.id, otherStore.id), {
      idempotencyKey: newKey("ST-CROSS-STORE"),
      lines: [{ batchId: batchOne.id, locationId: locationA.id, countedQty: 1 }],
    }),
    /库存批次.*不属于当前门店/,
  );

  // Confirmation compares counted versus current on-hand, not just the snapshot.
  await db.batchBalance.update({
    where: { batchId_locationId: { batchId: batchOne.id, locationId: locationA.id } },
    data: { onHandQty: 9 },
  });
  const firstConfirm = await confirm(scope, draft.stocktakeId);
  assert.equal(firstConfirm.alreadyConfirmed, false);
  assert.equal(firstConfirm.adjustmentCount, 2);

  const lineOne = lineOf(firstConfirm.lines, batchOne.id);
  assert.equal(lineOne.recordedQty, 10);
  assert.equal(lineOne.countedQty, 8.5);
  assert.equal(lineOne.differenceQty, -1.5);
  assert.equal(lineOne.adjustmentQty, -0.5);
  assert.ok(lineOne.transactionId);

  const lineTwo = lineOf(firstConfirm.lines, batchTwo.id);
  assert.equal(lineTwo.countedQty, 5);
  assert.equal(lineTwo.adjustmentQty, 0);
  assert.equal(lineTwo.transactionId, null);

  const lineThree = lineOf(firstConfirm.lines, batchNoBalance.id);
  assert.equal(lineThree.recordedQty, 0);
  assert.equal(lineThree.adjustmentQty, 2);
  assert.ok(lineThree.transactionId);

  assert.equal(await balanceQty(batchOne.id, locationA.id), 8.5);
  assert.equal(await balanceQty(batchTwo.id, locationB.id), 5);
  assert.equal(await balanceQty(batchNoBalance.id, locationB.id), 2);

  const confirmedStocktake = await db.stocktake.findUniqueOrThrow({
    where: { id: draft.stocktakeId },
  });
  assert.equal(confirmedStocktake.state, StocktakeState.CONFIRMED);
  assert.ok(confirmedStocktake.confirmedAt);
  const confirmedAt = confirmedStocktake.confirmedAt;

  const adjustmentTransactions = await db.inventoryTransaction.findMany({
    where: { batch: { storeId: store.id }, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(adjustmentTransactions.length, 2);
  for (const transaction of adjustmentTransactions) {
    assert.equal(transaction.referenceType, "STOCKTAKE_LINE");
    assert.ok(transaction.referenceId);
    const line = storedStocktake.lines.find((candidate) => candidate.id === transaction.referenceId);
    assert.ok(line);
    assert.equal(transaction.idempotencyKey, `STOCKTAKE:${draft.stocktakeId}:${line.id}`);
  }
  assert.equal(await db.auditEvent.count({
    where: { entityId: draft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  }), 1);

  const repeated = await confirm(scope, draft.stocktakeId);
  assert.equal(repeated.alreadyConfirmed, true);
  assert.equal(repeated.adjustmentCount, 2);
  assert.equal(lineOf(repeated.lines, batchOne.id).transactionId, lineOne.transactionId);
  assert.equal(lineOf(repeated.lines, batchOne.id).adjustmentQty, -0.5);
  assert.equal(lineOf(repeated.lines, batchNoBalance.id).transactionId, lineThree.transactionId);
  assert.equal(lineOf(repeated.lines, batchTwo.id).transactionId, null);
  assert.equal(await db.inventoryTransaction.count({
    where: { batch: { storeId: store.id }, kind: TransactionKind.ADJUSTMENT },
  }), 2);
  assert.equal(await balanceQty(batchOne.id, locationA.id), 8.5);
  assert.equal(await balanceQty(batchNoBalance.id, locationB.id), 2);
  assert.equal(await auditCountForStocktake(draft.stocktakeId), 2);
  const afterRepeated = await db.stocktake.findUniqueOrThrow({
    where: { id: draft.stocktakeId },
  });
  assert.equal(afterRepeated.confirmedAt?.getTime(), confirmedAt.getTime());

  // A stocktake where every counted quantity already matches writes no adjustment at all.
  const noDiffDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-NODIFF"),
    lines: [{ batchId: batchTwo.id, locationId: locationB.id, countedQty: 5 }],
  });
  const noDiffConfirm = await confirm(scope, noDiffDraft.stocktakeId);
  assert.equal(noDiffConfirm.adjustmentCount, 0);
  assert.equal(noDiffConfirm.lines[0].transactionId, null);
  assert.equal((await db.stocktake.findUniqueOrThrow({
    where: { id: noDiffDraft.stocktakeId },
  })).state, StocktakeState.CONFIRMED);

  // Cancelled stocktakes cannot be confirmed.
  const cancelledDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-CANCELLED"),
    lines: [{ batchId: batchCancelled.id, locationId: locationA.id, countedQty: 1 }],
  });
  await db.stocktake.update({
    where: { id: cancelledDraft.stocktakeId },
    data: { state: StocktakeState.CANCELLED },
  });
  await assert.rejects(
    confirm(scope, cancelledDraft.stocktakeId),
    /已取消/,
  );
  assert.equal(await balanceQty(batchCancelled.id, locationA.id), 3);

  // Counted zero is valid and sets on hand to zero without ever going negative.
  const zeroDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-ZERO"),
    lines: [{ batchId: batchZero.id, locationId: locationA.id, countedQty: 0 }],
  });
  const zeroConfirm = await confirm(scope, zeroDraft.stocktakeId);
  assert.equal(zeroConfirm.adjustmentCount, 1);
  assert.equal(zeroConfirm.lines[0].adjustmentQty, -2);
  assert.equal(await balanceQty(batchZero.id, locationA.id), 0);

  // A confirm must be scoped to the owning store/tenant.
  const scopedDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-CONFIRM-SCOPE"),
    lines: [{ batchId: batchTwo.id, locationId: locationB.id, countedQty: 5 }],
  });
  await assert.rejects(
    confirm(scopeOf(tenant.id, otherStore.id), scopedDraft.stocktakeId),
    /不属于当前门店/,
  );
  await assert.rejects(
    confirm(scopeOf(otherTenant.id, store.id), scopedDraft.stocktakeId),
    /不属于当前门店/,
  );
  assert.equal((await db.stocktake.findUniqueOrThrow({
    where: { id: scopedDraft.stocktakeId },
  })).state, StocktakeState.DRAFT);

  console.log("v2 stocktake tests passed");
}

async function auditCountForStocktake(stocktakeId: string): Promise<number> {
  return db.auditEvent.count({
    where: {
      entityId: stocktakeId,
      action: { in: ["STOCKTAKE_DRAFT_CREATED", "STOCKTAKE_CONFIRMED"] },
    },
  });
}

async function cleanup() {
  if (tenantIds.length === 0) return;
  const tenantFilter = { tenantId: { in: tenantIds } };
  const storeFilter = { store: { tenantId: { in: tenantIds } } };
  await db.auditEvent.deleteMany({ where: tenantFilter });
  await db.inventoryTransaction.deleteMany({ where: { batch: storeFilter } });
  await db.stocktakeLine.deleteMany({ where: { stocktake: storeFilter } });
  await db.stocktake.deleteMany({ where: storeFilter });
  await db.batchBalance.deleteMany({ where: { batch: storeFilter } });
  await db.inventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.sampleInventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.inventoryBatch.deleteMany({ where: storeFilter });
  await db.material.deleteMany({ where: tenantFilter });
  await db.inventoryLocation.deleteMany({ where: storeFilter });
  await db.store.deleteMany({ where: tenantFilter });
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
      console.error("stocktake cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
