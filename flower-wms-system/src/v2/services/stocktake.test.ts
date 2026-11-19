import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, LocationKind, MaterialKind, OrderEntry, OrderItemKind, PrismaClient,
  ProductionState, ReservationState, StocktakeState, SupplyState, TransactionKind,
} from "../../generated/prisma-v2/client";
import {
  confirmStocktake, createStocktakeDraft, reviewStocktake,
  type CreateStocktakeDraftInput, type ConfirmStocktakeLineResult,
} from "./stocktake";
import type { InventoryOperationScope } from "./inventory-operations";
import { cancelOrder } from "./order-lifecycle";

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

type ConfirmedAuditSnapshot = {
  supplyRisk?: {
    deficientBatches?: Array<{
      batchId: string;
      onHandQty: number;
      activeReservationQty: number;
      shortageQty: number;
    }>;
    affectedOrderIds?: string[];
  };
};

async function createOrderWithReservation(params: {
  label: string;
  tenantId: string;
  storeId: string;
  materialId: string;
  batchId: string;
  quantity: number;
  supplyState?: SupplyState;
  reservationState?: ReservationState;
  productionState?: ProductionState;
}) {
  const {
    label,
    tenantId,
    storeId,
    materialId,
    batchId,
    quantity,
    supplyState = SupplyState.ON_HAND_COVERED,
    reservationState = ReservationState.ACTIVE,
    productionState = ProductionState.READY,
  } = params;
  const order = await db.order.create({
    data: {
      tenantId,
      storeId,
      number: `${label}-${marker}-${crypto.randomUUID().slice(0, 6)}`,
      createdVia: OrderEntry.STAFF_PORTAL,
      sourceChannel: "盘点风险回归",
      commercialState: CommercialState.CONFIRMED,
      supplyState,
      productionState,
      deliveryAt: new Date(Date.now() + 86_400_000),
    },
  });
  const item = await db.orderItem.create({
    data: {
      orderId: order.id,
      kind: OrderItemKind.STANDARD,
      nameSnapshot: "盘点风险测试商品",
      quantity: Math.max(1, Math.ceil(quantity)),
      unitPrice: 10,
    },
  });
  const revision = await db.orderRevision.create({
    data: { orderId: order.id, number: 1, reason: "盘点风险测试" },
  });
  const requirement = await db.orderMaterialRequirement.create({
    data: {
      orderItemId: item.id,
      revisionId: revision.id,
      materialId,
      plannedQty: quantity,
      needBy: new Date(Date.now() + 86_400_000),
    },
  });
  const reservation = await db.inventoryReservation.create({
    data: {
      requirementId: requirement.id,
      batchId,
      quantity,
      state: reservationState,
    },
  });
  const task = await db.productionTask.create({
    data: {
      orderItemId: item.id,
      quantity: item.quantity,
      state: productionState,
    },
  });
  return { order, item, revision, requirement, reservation, task };
}

async function supplyStateOf(orderId: string): Promise<SupplyState> {
  return (await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { supplyState: true },
  })).supplyState;
}

async function activeReservationQty(batchId: string): Promise<number> {
  const result = await db.inventoryReservation.aggregate({
    where: { batchId, state: ReservationState.ACTIVE },
    _sum: { quantity: true },
  });
  return Number(result._sum.quantity ?? 0);
}

/**
 * Runs confirmation with a transaction proxy that triggers a real cancellation immediately before
 * the service's FOR UPDATE NOWAIT statement is forwarded. This makes the snapshot race
 * deterministic: the initial risk read still sees both orders, while the order lock and the
 * following revalidation see the committed cancellation and released reservations.
 */
async function confirmWithCancellationBeforeOrderLock(
  scope: InventoryOperationScope,
  stocktakeId: string,
  cancel: () => Promise<void>,
) {
  return db.$transaction(async (tx) => {
    let cancellationTriggered = false;
    const proxied = new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property !== "$queryRaw") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          const query = args[0];
          const sql = Array.isArray(query) ? query.join("?") : String(query ?? "");
          if (!cancellationTriggered && sql.includes("FOR UPDATE NOWAIT")) {
            cancellationTriggered = true;
            await cancel();
          }
          return Reflect.apply(
            value as (...params: unknown[]) => Promise<unknown>,
            target,
            args,
          );
        };
      },
    });
    return confirmStocktake(proxied, scope, stocktakeId);
  });
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
  const reviewer = await db.staffUser.create({
    data: {
      username: `stocktake-reviewer-${marker}`,
      passwordHash: "test-only",
      tenantMembers: { create: { tenantId: tenant.id, roles: ["MANAGER"] } },
      storeMembers: { create: { storeId: store.id, roles: ["MANAGER"] } },
    },
  });
  const inventoryReviewer = await db.staffUser.create({
    data: {
      username: `stocktake-inventory-reviewer-${marker}`,
      passwordHash: "test-only",
      tenantMembers: { create: { tenantId: tenant.id, roles: ["INVENTORY_REVIEWER"] } },
      storeMembers: { create: { storeId: store.id, roles: ["INVENTORY_REVIEWER"] } },
    },
  });
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: `OTHER-${marker}`, name: "盘点另一门店" },
  });
  const operator = await db.staffUser.create({ data: {
    username: `stocktake-operator-${marker}`, passwordHash: "test-only",
    tenantMembers: { create: { tenantId: tenant.id, roles: ["BUYER"] } },
    storeMembers: { create: { storeId: store.id, roles: ["BUYER"] } },
  } });
  const crossStoreManager = await db.staffUser.create({ data: {
    username: `stocktake-cross-manager-${marker}`, passwordHash: "test-only",
    tenantMembers: { create: { tenantId: tenant.id, roles: ["MANAGER"] } },
    storeMembers: { create: { storeId: otherStore.id, roles: ["MANAGER"] } },
  } });
  await db.storeSettings.create({ data: {
    tenantId: tenant.id, storeId: store.id, deliveryConfig: {}, capacityConfig: {},
    lossReviewThreshold: 2,
  } });
  const otherTenantStore = await db.store.create({
    data: { tenantId: otherTenant.id, code: `FOREIGN-${marker}`, name: "盘点外租户门店" },
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

  const scope = { ...scopeOf(tenant.id, store.id), actorStaffId: reviewer.id };

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

  // A conflict on the last line must undo the balance and ledger writes for the first line.
  const rollbackDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-ROLLBACK"),
    lines: [
      { batchId: batchOne.id, locationId: locationA.id, countedQty: 7 },
      { batchId: batchTwo.id, locationId: locationB.id, countedQty: 4 },
    ],
  });
  const [firstLine, lastLine] = await db.stocktakeLine.findMany({
    where: { stocktakeId: rollbackDraft.stocktakeId },
    orderBy: { id: "asc" },
  });
  const conflictKey = `STOCKTAKE:${rollbackDraft.stocktakeId}:${lastLine.id}`;
  await db.inventoryTransaction.create({
    data: {
      batchId: lastLine.batchId,
      kind: TransactionKind.ADJUSTMENT,
      quantity: 1,
      fromLocationId: lastLine.locationId,
      referenceType: "STOCKTAKE_LINE",
      referenceId: lastLine.id,
      idempotencyKey: conflictKey,
    },
  });

  await assert.rejects(confirm(scope, rollbackDraft.stocktakeId), /已存在调整流水/);
  assert.equal(await balanceQty(batchOne.id, locationA.id), 8.5);
  assert.equal(await balanceQty(batchTwo.id, locationB.id), 5);
  assert.equal(await db.inventoryTransaction.count({
    where: { idempotencyKey: `STOCKTAKE:${rollbackDraft.stocktakeId}:${firstLine.id}` },
  }), 0);
  assert.equal(await db.auditEvent.count({
    where: { entityId: rollbackDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  }), 0);
  assert.equal((await db.stocktake.findUniqueOrThrow({
    where: { id: rollbackDraft.stocktakeId },
  })).state, StocktakeState.DRAFT);

  // WMS-BR-INV-003: a counted shortage keeps every reservation and downgrades all fully covered
  // orders that hold an active reservation on the deficient batch. No loss-allocation priority
  // is applied, so the large order is downgraded together with the two small ones.
  const riskBatch = await createBatch("RISK-A");
  await db.batchBalance.create({
    data: { batchId: riskBatch.id, locationId: locationA.id, onHandQty: 10 },
  });
  const riskOrderLarge = await createOrderWithReservation({
    label: "RISK-LARGE",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: riskBatch.id,
    quantity: 6,
  });
  const riskOrderSmallOne = await createOrderWithReservation({
    label: "RISK-SMALL-1",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: riskBatch.id,
    quantity: 2,
  });
  const riskOrderSmallTwo = await createOrderWithReservation({
    label: "RISK-SMALL-2",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: riskBatch.id,
    quantity: 2,
  });

  const riskDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-A"),
    lines: [{
      batchId: riskBatch.id,
      locationId: locationA.id,
      countedQty: 8,
      reason: "盘亏复核",
    }],
  });
  const riskConfirm = await confirm(scope, riskDraft.stocktakeId);
  assert.equal(riskConfirm.alreadyConfirmed, false);
  assert.equal(riskConfirm.adjustmentCount, 1);
  assert.equal(lineOf(riskConfirm.lines, riskBatch.id).adjustmentQty, -2);
  assert.ok(lineOf(riskConfirm.lines, riskBatch.id).transactionId);
  assert.equal(await balanceQty(riskBatch.id, locationA.id), 8);

  const riskTransactions = await db.inventoryTransaction.findMany({
    where: { batchId: riskBatch.id, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(riskTransactions.length, 1);
  assert.equal(Number(riskTransactions[0].quantity), 2);
  assert.equal(riskTransactions[0].fromLocationId, locationA.id);
  assert.equal(riskTransactions[0].toLocationId, null);
  assert.equal(await activeReservationQty(riskBatch.id), 10);

  const expectedRiskOrderIds = [
    riskOrderLarge.order.id,
    riskOrderSmallOne.order.id,
    riskOrderSmallTwo.order.id,
  ].sort();
  for (const fixture of [riskOrderLarge, riskOrderSmallOne, riskOrderSmallTwo]) {
    const reservation = await db.inventoryReservation.findUniqueOrThrow({
      where: { id: fixture.reservation.id },
    });
    assert.equal(reservation.state, ReservationState.ACTIVE);
    assert.equal(Number(reservation.quantity), Number(fixture.reservation.quantity));
    assert.equal(await supplyStateOf(fixture.order.id), SupplyState.PARTIALLY_COVERED);
    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } });
    assert.equal(order.productionState, ProductionState.READY);
    assert.equal(order.version, 1);
    const task = await db.productionTask.findUniqueOrThrow({ where: { id: fixture.task.id } });
    assert.equal(task.state, ProductionState.READY);
    assert.equal(task.startedAt, null);
  }
  assert.equal(await db.materialUsage.count({
    where: { task: { orderItem: { orderId: riskOrderLarge.order.id } } },
  }), 0);

  const riskAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: riskDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  });
  const riskSnapshot = riskAudit.afterSnapshot as ConfirmedAuditSnapshot;
  assert.deepEqual(riskSnapshot.supplyRisk?.affectedOrderIds, expectedRiskOrderIds);
  assert.deepEqual(riskSnapshot.supplyRisk?.deficientBatches, [{
    batchId: riskBatch.id,
    onHandQty: 8,
    activeReservationQty: 10,
    shortageQty: 2,
  }]);

  const riskRepeated = await confirm(scope, riskDraft.stocktakeId);
  assert.equal(riskRepeated.alreadyConfirmed, true);
  assert.equal(riskRepeated.adjustmentCount, 1);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: riskBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: riskDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  }), 1);
  assert.equal(await activeReservationQty(riskBatch.id), 10);
  assert.equal(await supplyStateOf(riskOrderLarge.order.id), SupplyState.PARTIALLY_COVERED);

  // Final totals include every location, even one without a stocktake line. Equality with the
  // scoped active reservations is not a risk, and a foreign-tenant reservation is ignored.
  const safeBatch = await createBatch("RISK-SAFE");
  await db.batchBalance.createMany({
    data: [
      { batchId: safeBatch.id, locationId: locationA.id, onHandQty: 10 },
      { batchId: safeBatch.id, locationId: locationB.id, onHandQty: 2 },
    ],
  });
  const safeOrder = await createOrderWithReservation({
    label: "RISK-SAFE-ORDER",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: safeBatch.id,
    quantity: 10,
  });
  const foreignOrder = await createOrderWithReservation({
    label: "RISK-FOREIGN-ORDER",
    tenantId: otherTenant.id,
    storeId: otherTenantStore.id,
    materialId: material.id,
    batchId: safeBatch.id,
    quantity: 25,
  });

  const safeDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-SAFE"),
    lines: [{ batchId: safeBatch.id, locationId: locationA.id, countedQty: 8 }],
  });
  const safeConfirm = await confirm(scope, safeDraft.stocktakeId);
  assert.equal(safeConfirm.adjustmentCount, 1);
  assert.equal(lineOf(safeConfirm.lines, safeBatch.id).adjustmentQty, -2);
  assert.equal(await balanceQty(safeBatch.id, locationA.id), 8);
  assert.equal(await balanceQty(safeBatch.id, locationB.id), 2);
  assert.equal(await activeReservationQty(safeBatch.id), 35);
  assert.equal(await supplyStateOf(safeOrder.order.id), SupplyState.ON_HAND_COVERED);
  assert.equal(await supplyStateOf(foreignOrder.order.id), SupplyState.ON_HAND_COVERED);

  const safeAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: safeDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  });
  assert.deepEqual((safeAudit.afterSnapshot as ConfirmedAuditSnapshot).supplyRisk, {
    deficientBatches: [],
    affectedOrderIds: [],
  });

  // Two counted rows of the same batch and an uncounted location are combined into the final
  // total. A non-covered order and a released reservation are not candidates for the downgrade.
  const multiLocation = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `MULTI-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  const multiBatch = await createBatch("RISK-MULTI");
  await db.batchBalance.createMany({
    data: [
      { batchId: multiBatch.id, locationId: locationA.id, onHandQty: 4 },
      { batchId: multiBatch.id, locationId: locationB.id, onHandQty: 4 },
      { batchId: multiBatch.id, locationId: multiLocation.id, onHandQty: 2 },
    ],
  });
  const multiCoveredOrder = await createOrderWithReservation({
    label: "RISK-MULTI-COVERED",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: multiBatch.id,
    quantity: 6,
  });
  const multiNonCoveredOrder = await createOrderWithReservation({
    label: "RISK-MULTI-NONCOVERED",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: multiBatch.id,
    quantity: 2,
    supplyState: SupplyState.PURCHASE_REQUIRED,
    productionState: ProductionState.WAITING_MATERIAL,
  });
  const multiReleasedOrder = await createOrderWithReservation({
    label: "RISK-MULTI-RELEASED",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: multiBatch.id,
    quantity: 5,
    reservationState: ReservationState.RELEASED,
  });

  const multiDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-MULTI"),
    lines: [
      { batchId: multiBatch.id, locationId: locationA.id, countedQty: 2 },
      { batchId: multiBatch.id, locationId: locationB.id, countedQty: 2 },
    ],
  });
  const multiConfirm = await confirm(scope, multiDraft.stocktakeId);
  assert.equal(multiConfirm.adjustmentCount, 2);
  assert.equal(await balanceQty(multiBatch.id, locationA.id), 2);
  assert.equal(await balanceQty(multiBatch.id, locationB.id), 2);
  assert.equal(await balanceQty(multiBatch.id, multiLocation.id), 2);

  const multiTransactions = await db.inventoryTransaction.findMany({
    where: { batchId: multiBatch.id, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(multiTransactions.length, 2);
  assert.deepEqual(
    multiTransactions.map((transaction) => transaction.fromLocationId).sort(),
    [locationA.id, locationB.id].sort(),
  );
  assert.ok(multiTransactions.every((transaction) => transaction.toLocationId === null));
  assert.equal(await activeReservationQty(multiBatch.id), 8);
  assert.equal(await supplyStateOf(multiCoveredOrder.order.id), SupplyState.PARTIALLY_COVERED);
  assert.equal(await supplyStateOf(multiNonCoveredOrder.order.id), SupplyState.PURCHASE_REQUIRED);
  assert.equal(await supplyStateOf(multiReleasedOrder.order.id), SupplyState.ON_HAND_COVERED);

  const multiAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: multiDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  });
  const multiSnapshot = multiAudit.afterSnapshot as ConfirmedAuditSnapshot;
  assert.deepEqual(multiSnapshot.supplyRisk?.affectedOrderIds, [multiCoveredOrder.order.id]);
  assert.deepEqual(multiSnapshot.supplyRisk?.deficientBatches, [{
    batchId: multiBatch.id,
    onHandQty: 6,
    activeReservationQty: 8,
    shortageQty: 2,
  }]);

  // An ACTIVE reservation from a superseded revision is historical: it must not increase the
  // batch total or nominate the order for a downgrade.
  const historicalBatch = await createBatch("RISK-HISTORICAL");
  await db.batchBalance.create({
    data: { batchId: historicalBatch.id, locationId: locationA.id, onHandQty: 6 },
  });
  const historicalOrder = await createOrderWithReservation({
    label: "RISK-HISTORICAL-ORDER",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: historicalBatch.id,
    quantity: 10,
  });
  const currentRevision = await db.orderRevision.create({
    data: { orderId: historicalOrder.order.id, number: 2, reason: "当前修订" },
  });
  const currentRequirement = await db.orderMaterialRequirement.create({
    data: {
      orderItemId: historicalOrder.item.id,
      revisionId: currentRevision.id,
      materialId: material.id,
      plannedQty: 2,
      needBy: new Date(Date.now() + 86_400_000),
    },
  });
  await db.inventoryReservation.create({
    data: {
      requirementId: currentRequirement.id,
      batchId: historicalBatch.id,
      quantity: 2,
      state: ReservationState.ACTIVE,
    },
  });
  await db.order.update({
    where: { id: historicalOrder.order.id },
    data: { version: 2 },
  });

  const historicalDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-HISTORICAL"),
    lines: [{ batchId: historicalBatch.id, locationId: locationA.id, countedQty: 6 }],
  });
  const historicalConfirm = await confirm(scope, historicalDraft.stocktakeId);
  assert.equal(historicalConfirm.adjustmentCount, 0);
  assert.equal(await supplyStateOf(historicalOrder.order.id), SupplyState.ON_HAND_COVERED);
  assert.equal((await db.inventoryReservation.findUniqueOrThrow({
    where: { id: historicalOrder.reservation.id },
  })).state, ReservationState.ACTIVE);
  const historicalAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: historicalDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  });
  assert.deepEqual((historicalAudit.afterSnapshot as ConfirmedAuditSnapshot).supplyRisk, {
    deficientBatches: [],
    affectedOrderIds: [],
  });

  // An independent transaction holding the affected order lock must make confirmation fail fast
  // through NOWAIT, leaving the draft, balance, ledger, audit and order untouched. After the lock
  // is released the same confirmation succeeds normally.
  const lockBatch = await createBatch("RISK-LOCK");
  await db.batchBalance.create({
    data: { batchId: lockBatch.id, locationId: locationA.id, onHandQty: 10 },
  });
  const lockOrder = await createOrderWithReservation({
    label: "RISK-LOCK-ORDER",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: lockBatch.id,
    quantity: 10,
  });
  const lockDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-LOCK"),
    lines: [{ batchId: lockBatch.id, locationId: locationA.id, countedQty: 8 }],
  });

  let releaseOrderLock: (() => void) | undefined;
  let signalOrderLock: (() => void) | undefined;
  const orderLocked = new Promise<void>((resolve) => {
    signalOrderLock = resolve;
  });
  const holdingTransaction = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${lockOrder.order.id} FOR UPDATE`;
    signalOrderLock?.();
    await new Promise<void>((resolve) => {
      releaseOrderLock = resolve;
    });
  }, { timeout: 30_000 });

  try {
    await orderLocked;
    await assert.rejects(
      confirm(scope, lockDraft.stocktakeId),
      /正在被其他操作处理/,
    );
    assert.equal((await db.stocktake.findUniqueOrThrow({
      where: { id: lockDraft.stocktakeId },
    })).state, StocktakeState.DRAFT);
    assert.equal(await balanceQty(lockBatch.id, locationA.id), 10);
    assert.equal(await db.inventoryTransaction.count({
      where: { batchId: lockBatch.id, kind: TransactionKind.ADJUSTMENT },
    }), 0);
    assert.equal(await db.auditEvent.count({
      where: { entityId: lockDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
    }), 0);
    assert.equal(await supplyStateOf(lockOrder.order.id), SupplyState.ON_HAND_COVERED);
    assert.equal(await activeReservationQty(lockBatch.id), 10);
  } finally {
    releaseOrderLock?.();
    await holdingTransaction;
  }

  const lockRetry = await confirm(scope, lockDraft.stocktakeId);
  assert.equal(lockRetry.alreadyConfirmed, false);
  assert.equal(lockRetry.adjustmentCount, 1);
  assert.equal(await balanceQty(lockBatch.id, locationA.id), 8);
  assert.equal(await supplyStateOf(lockOrder.order.id), SupplyState.PARTIALLY_COVERED);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: lockBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 1);

  // Cancellation releases reservations without a batch lock. If it commits between the initial
  // risk read and the NOWAIT order lock, confirmation must revalidate and leave both the cancelled
  // order and the remaining covered order untouched because its reservation now fits.
  const snapshotBatch = await createBatch("RISK-SNAPSHOT");
  await db.batchBalance.create({
    data: { batchId: snapshotBatch.id, locationId: locationA.id, onHandQty: 10 },
  });
  const snapshotCancelledOrder = await createOrderWithReservation({
    label: "RISK-SNAPSHOT-CANCELLED",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: snapshotBatch.id,
    quantity: 8,
  });
  const snapshotRemainingOrder = await createOrderWithReservation({
    label: "RISK-SNAPSHOT-REMAINING",
    tenantId: tenant.id,
    storeId: store.id,
    materialId: material.id,
    batchId: snapshotBatch.id,
    quantity: 2,
  });
  const snapshotDraft = await createDraft(scope, {
    idempotencyKey: newKey("ST-RISK-SNAPSHOT"),
    lines: [{ batchId: snapshotBatch.id, locationId: locationA.id, countedQty: 8 }],
  });

  const snapshotConfirm = await confirmWithCancellationBeforeOrderLock(
    scope,
    snapshotDraft.stocktakeId,
    async () => {
      await cancelOrder(db, {
        tenantId: tenant.id,
        storeId: store.id,
        orderId: snapshotCancelledOrder.order.id,
        actorStaffId: scope.actorStaffId,
        reason: "并发取消释放预留",
      });
    },
  );
  assert.equal(snapshotConfirm.alreadyConfirmed, false);
  assert.equal(snapshotConfirm.adjustmentCount, 1);
  assert.equal(await balanceQty(snapshotBatch.id, locationA.id), 8);
  assert.equal(await activeReservationQty(snapshotBatch.id), 2);
  assert.equal((await db.inventoryReservation.findUniqueOrThrow({
    where: { id: snapshotCancelledOrder.reservation.id },
  })).state, ReservationState.RELEASED);
  assert.equal((await db.inventoryReservation.findUniqueOrThrow({
    where: { id: snapshotRemainingOrder.reservation.id },
  })).state, ReservationState.ACTIVE);
  assert.equal(await supplyStateOf(snapshotCancelledOrder.order.id), SupplyState.ON_HAND_COVERED);
  assert.equal(await supplyStateOf(snapshotRemainingOrder.order.id), SupplyState.ON_HAND_COVERED);
  assert.equal((await db.order.findUniqueOrThrow({
    where: { id: snapshotCancelledOrder.order.id },
  })).commercialState, CommercialState.CANCELLED);

  const snapshotTransactions = await db.inventoryTransaction.findMany({
    where: { batchId: snapshotBatch.id, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(snapshotTransactions.length, 1);
  assert.equal(Number(snapshotTransactions[0].quantity), 2);
  const snapshotAudit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: snapshotDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  });
  assert.deepEqual((snapshotAudit.afterSnapshot as ConfirmedAuditSnapshot).supplyRisk, {
    deficientBatches: [],
    affectedOrderIds: [],
  });

  const snapshotRepeated = await confirm(scope, snapshotDraft.stocktakeId);
  assert.equal(snapshotRepeated.alreadyConfirmed, true);
  assert.equal(snapshotRepeated.adjustmentCount, 1);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: snapshotBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 1);

  // WMS-BR-INV-006: equality never needs review, regardless of direction. A difference above
  // the threshold needs review by absolute value, including an inventory gain.
  const thresholdEqualBatch = await createBatch("THRESHOLD-EQUAL");
  await db.batchBalance.create({ data: { batchId: thresholdEqualBatch.id, locationId: locationA.id, onHandQty: 5 } });
  const operatorScope = { tenantId: tenant.id, storeId: store.id, actorStaffId: operator.id };
  const thresholdEqualDraft = await createDraft(operatorScope, {
    idempotencyKey: newKey("THRESHOLD-EQUAL"),
    lines: [{ batchId: thresholdEqualBatch.id, locationId: locationA.id, countedQty: 3 }],
  });
  const thresholdEqualResult = await confirm(operatorScope, thresholdEqualDraft.stocktakeId);
  assert.equal(thresholdEqualResult.pendingReview, undefined);
  assert.equal(await balanceQty(thresholdEqualBatch.id, locationA.id), 3);

  const thresholdEqualGainBatch = await createBatch("THRESHOLD-EQUAL-GAIN");
  await db.batchBalance.create({ data: { batchId: thresholdEqualGainBatch.id, locationId: locationA.id, onHandQty: 5 } });
  const thresholdEqualGainDraft = await createDraft(operatorScope, {
    idempotencyKey: newKey("THRESHOLD-EQUAL-GAIN"),
    lines: [{ batchId: thresholdEqualGainBatch.id, locationId: locationA.id, countedQty: 7 }],
  });
  const thresholdEqualGainResult = await confirm(operatorScope, thresholdEqualGainDraft.stocktakeId);
  assert.equal(thresholdEqualGainResult.pendingReview, undefined);
  assert.equal(thresholdEqualGainResult.adjustmentCount, 1);
  assert.equal(await balanceQty(thresholdEqualGainBatch.id, locationA.id), 7);
  const equalGainTransactions = await db.inventoryTransaction.findMany({
    where: { batchId: thresholdEqualGainBatch.id, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(equalGainTransactions.length, 1);
  assert.equal(Number(equalGainTransactions[0].quantity), 2);
  assert.equal(equalGainTransactions[0].toLocationId, locationA.id);
  assert.equal(equalGainTransactions[0].fromLocationId, null);

  const thresholdAboveBatch = await createBatch("THRESHOLD-ABOVE");
  await db.batchBalance.create({ data: { batchId: thresholdAboveBatch.id, locationId: locationA.id, onHandQty: 5 } });
  const thresholdAboveDraft = await createDraft(operatorScope, {
    idempotencyKey: newKey("THRESHOLD-ABOVE"),
    lines: [{ batchId: thresholdAboveBatch.id, locationId: locationA.id, countedQty: 2 }],
  });
  const thresholdAboveResult = await confirm(operatorScope, thresholdAboveDraft.stocktakeId);
  assert.equal(thresholdAboveResult.pendingReview, true);
  assert.deepEqual(thresholdAboveResult.reviewReasons, ["盘点差异超过门店阈值"]);
  assert.equal(await balanceQty(thresholdAboveBatch.id, locationA.id), 5);
  await assert.rejects(db.$transaction((tx) => reviewStocktake(tx, {
    tenantId: tenant.id, storeId: store.id, actorStaffId: crossStoreManager.id,
  }, thresholdAboveDraft.stocktakeId, "APPROVE", "跨店审批")), /本店经理或授权人员/);
  await db.$transaction((tx) => reviewStocktake(tx, scope, thresholdAboveDraft.stocktakeId, "APPROVE", "本店经理复核"));
  assert.equal(await balanceQty(thresholdAboveBatch.id, locationA.id), 2);

  const gainBatch = await createBatch("THRESHOLD-GAIN");
  await db.batchBalance.create({ data: { batchId: gainBatch.id, locationId: locationA.id, onHandQty: 5 } });
  const gainDraft = await createDraft(operatorScope, {
    idempotencyKey: newKey("THRESHOLD-GAIN"),
    lines: [{ batchId: gainBatch.id, locationId: locationA.id, countedQty: 8 }],
  });
  const gainConfirm = await confirm(operatorScope, gainDraft.stocktakeId);
  assert.equal(gainConfirm.alreadyConfirmed, false);
  assert.equal(gainConfirm.pendingReview, true);
  assert.equal(gainConfirm.adjustmentCount, 0);
  assert.deepEqual(gainConfirm.reviewReasons, ["盘点差异超过门店阈值"]);
  assert.deepEqual(gainConfirm.lines, []);
  assert.equal(await balanceQty(gainBatch.id, locationA.id), 5);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: gainBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 0);
  const pendingGain = await db.stocktake.findUniqueOrThrow({
    where: { id: gainDraft.stocktakeId },
  });
  assert.equal(pendingGain.state, StocktakeState.PENDING_REVIEW);
  assert.deepEqual(pendingGain.reviewReasons, ["盘点差异超过门店阈值"]);
  assert.equal(pendingGain.submittedById, operator.id);
  assert.equal(pendingGain.reviewedById, null);
  assert.equal(pendingGain.confirmedAt, null);
  assert.equal(await db.auditEvent.count({
    where: { entityId: gainDraft.stocktakeId, action: "STOCKTAKE_REVIEW_REQUESTED" },
  }), 1);
  assert.equal(await db.auditEvent.count({
    where: { entityId: gainDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  }), 0);

  // Neither the operator nor a manager from another store can approve the pending gain.
  await assert.rejects(db.$transaction((tx) => reviewStocktake(tx, operatorScope,
    gainDraft.stocktakeId, "APPROVE", "自审")), /本店经理或授权人员/);
  await assert.rejects(db.$transaction((tx) => reviewStocktake(tx, {
    tenantId: tenant.id, storeId: store.id, actorStaffId: crossStoreManager.id,
  }, gainDraft.stocktakeId, "APPROVE", "跨店审批")), /本店经理或授权人员/);
  assert.equal(await balanceQty(gainBatch.id, locationA.id), 5);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: gainBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 0);

  const inventoryReviewerScope = {
    ...scopeOf(tenant.id, store.id),
    actorStaffId: inventoryReviewer.id,
  };
  await db.$transaction((tx) => reviewStocktake(
    tx, inventoryReviewerScope, gainDraft.stocktakeId, "APPROVE", "本店复核盘盈",
  ));
  assert.equal(await balanceQty(gainBatch.id, locationA.id), 8);
  const gainTransactions = await db.inventoryTransaction.findMany({
    where: { batchId: gainBatch.id, kind: TransactionKind.ADJUSTMENT },
  });
  assert.equal(gainTransactions.length, 1);
  assert.equal(Number(gainTransactions[0].quantity), 3);
  assert.equal(gainTransactions[0].fromLocationId, null);
  assert.equal(gainTransactions[0].toLocationId, locationA.id);
  const approvedGain = await db.stocktake.findUniqueOrThrow({
    where: { id: gainDraft.stocktakeId },
  });
  assert.equal(approvedGain.state, StocktakeState.CONFIRMED);
  assert.equal(approvedGain.reviewedById, inventoryReviewer.id);
  assert.equal(approvedGain.reviewNote, "本店复核盘盈");
  assert.deepEqual(approvedGain.reviewReasons, ["盘点差异超过门店阈值"]);
  assert.ok(approvedGain.confirmedAt);
  assert.equal(await db.auditEvent.count({
    where: { entityId: gainDraft.stocktakeId, action: "STOCKTAKE_CONFIRMED" },
  }), 1);

  const gainRepeated = await confirm(operatorScope, gainDraft.stocktakeId);
  assert.equal(gainRepeated.alreadyConfirmed, true);
  assert.equal(gainRepeated.adjustmentCount, 1);
  assert.equal(await balanceQty(gainBatch.id, locationA.id), 8);
  assert.equal(await db.inventoryTransaction.count({
    where: { batchId: gainBatch.id, kind: TransactionKind.ADJUSTMENT },
  }), 1);

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
  await db.materialUsage.deleteMany({ where: { task: { orderItem: { order: tenantFilter } } } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenantFilter } } });
  await db.inventoryReservation.deleteMany({
    where: { requirement: { orderItem: { order: tenantFilter } } },
  });
  await db.orderMaterialRequirement.deleteMany({
    where: { orderItem: { order: tenantFilter } },
  });
  await db.orderItem.deleteMany({ where: { order: tenantFilter } });
  await db.orderRevision.deleteMany({ where: { order: tenantFilter } });
  await db.order.deleteMany({ where: tenantFilter });
  await db.inventoryBatch.deleteMany({ where: storeFilter });
  await db.material.deleteMany({ where: tenantFilter });
  await db.inventoryLocation.deleteMany({ where: storeFilter });
  await db.storeSettings.deleteMany({ where: tenantFilter });
  await db.storeMember.deleteMany({ where: { store: { tenantId: { in: tenantIds } } } });
  await db.tenantMember.deleteMany({ where: tenantFilter });
  await db.store.deleteMany({ where: tenantFilter });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.staffUser.deleteMany({ where: { username: { startsWith: "stocktake-" } } });
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
