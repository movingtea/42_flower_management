import {
  CostKind, CostStage, Prisma, type PrismaClient,
} from "../../generated/prisma-v2-draft/client";

/**
 * Finalizes an estimated inventory batch unit cost and reconciles every already recorded
 * MaterialUsage of that batch.
 *
 * Open orders (no OrderCostSnapshot yet) have their actual MATERIAL and LOSS CostEntry rows
 * recalculated from all usage of the task at the now-final batch costs. Closed orders keep their
 * immutable first snapshot and receive signed CostAdjustment rows against that snapshot instead.
 *
 * Safety rules:
 * - the batch row is locked, so retries and concurrent finalizations cannot apply twice;
 * - a batch that is already final may only be re-submitted with the exact same unit cost (no-op);
 * - material and loss stay separate in both CostEntry and CostAdjustment;
 * - the whole reconciliation is one transaction, so any later validation failure rolls back the
 *   batch update and every cost write.
 */
export type AdjustFinalCostInput = {
  tenantId: string;
  storeId: string;
  batchId: string;
  finalUnitCost: number | string;
  reason: string;
};

export type AdjustFinalCostResult = {
  applied: boolean;
  alreadyFinalized: boolean;
  batchId: string;
  previousUnitCost: number;
  finalUnitCost: number;
  unitCostDelta: number;
  openOrders: number;
  closedOrders: number;
  costEntriesUpdated: number;
  adjustmentsCreated: number;
};

const COST_ENTRY_SOURCE = "PRODUCTION_TASK";
const ADJUSTMENT_SOURCE = "INVENTORY_BATCH_FINAL_COST";

// The project targets ES2017, so write bigint values through the constructor instead of literals.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10_000);
const HUNDRED_THOUSAND = BigInt(100_000);

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}不能为空`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label}不能为空`);
  return trimmed;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${label}必须为有效数字`);
}

/** Unit cost has four decimal places in the schema, so compare micro-units as integers. */
function unitCostToMicros(value: unknown, label: string): bigint {
  const amount = finiteNumber(value, label);
  if (amount < 0) throw new Error(`${label}不能为负数`);
  const scaled = amount * 10_000;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) throw new Error(`${label}最多保留四位小数`);
  return BigInt(rounded);
}

function decimalToMicros(value: unknown): bigint {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("批次成本无效");
  return BigInt(Math.round(amount * 10_000));
}

function decimalToCents(value: unknown): bigint {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("已记录的成本金额无效");
  return BigInt(Math.round(amount * 100));
}

/** Quantity has three decimal places in the schema. */
function quantityToMilli(value: unknown): bigint {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) throw new Error("用料数量无效");
  return BigInt(Math.round(quantity * 1_000));
}

/**
 * Converts a sum of (currency micro-unit * quantity milli-unit) into rounded cents.
 * The divisor is 100_000: 10^-4 currency * 10^-3 quantity = 10^-7 currency, and there are
 * 100_000 such units in one cent.
 */
function roundToCents(microMilli: bigint): bigint {
  const divisor = HUNDRED_THOUSAND;
  const negative = microMilli < ZERO;
  const absolute = negative ? -microMilli : microMilli;
  let cents = absolute / divisor;
  if ((absolute % divisor) * TWO >= divisor) cents += ONE;
  return negative ? -cents : cents;
}

function centsToAmount(cents: bigint): string {
  const negative = cents < ZERO;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / HUNDRED}.${(absolute % HUNDRED).toString().padStart(2, "0")}`;
}

function microsToUnitCost(micros: bigint): number {
  return Number(micros) / 10_000;
}

type CostEntrySync = {
  orderId: string;
  taskId: string;
  kind: CostKind;
  amountCents: bigint;
  estimated: boolean;
};

/** Sets the one actual CostEntry belonging to a production task, creating it only when needed. */
async function syncCostEntry(tx: Prisma.TransactionClient, input: CostEntrySync): Promise<boolean> {
  const existing = await tx.costEntry.findFirst({
    where: {
      orderId: input.orderId,
      kind: input.kind,
      stage: CostStage.ACTUAL,
      sourceType: COST_ENTRY_SOURCE,
      sourceId: input.taskId,
    },
    orderBy: { id: "asc" },
  });

  if (!existing) {
    if (input.amountCents <= ZERO) return false;
    await tx.costEntry.create({
      data: {
        orderId: input.orderId,
        kind: input.kind,
        stage: CostStage.ACTUAL,
        amount: centsToAmount(input.amountCents),
        estimated: input.estimated,
        sourceType: COST_ENTRY_SOURCE,
        sourceId: input.taskId,
      },
    });
    return true;
  }

  if (decimalToCents(existing.amount) === input.amountCents && existing.estimated === input.estimated) {
    return false;
  }
  await tx.costEntry.update({
    where: { id: existing.id },
    data: {
      amount: centsToAmount(input.amountCents),
      estimated: input.estimated,
      calculatedAt: new Date(),
    },
  });
  return true;
}

/**
 * Finalizes one estimated batch. A repeated call with the same final cost is an idempotent no-op;
 * a repeated call with a different final cost is rejected because a finalized batch is immutable.
 */
export async function adjustFinalCost(
  db: PrismaClient,
  input: AdjustFinalCostInput,
): Promise<AdjustFinalCostResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const batchId = requiredText(input.batchId, "批次");
  const reason = requiredText(input.reason, "成本调整原因");
  const finalMicros = unitCostToMicros(input.finalUnitCost, "最终单位成本");

  return db.$transaction(async (tx) => {
    // Lock affected orders first, in a stable order, then the batch. Existing production code locks
    // the order before its batches, so this order avoids a lock cycle with completeProduction.
    const candidates = await tx.materialUsage.findMany({
      where: { batchId },
      select: { task: { select: { orderItem: { select: { orderId: true } } } } },
    });
    const candidateOrderIds = [...new Set(
      candidates.map((row) => row.task.orderItem.orderId),
    )].sort();
    for (const orderId of candidateOrderIds) {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    }

    const lockedBatch = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "InventoryBatch" WHERE id = ${batchId} FOR UPDATE
    `;
    if (lockedBatch.length !== 1) throw new Error("批次不存在");

    const batch = await tx.inventoryBatch.findUnique({
      where: { id: batchId },
      include: { store: true, material: true },
    });
    if (!batch
        || batch.storeId !== storeId
        || batch.store.tenantId !== tenantId
        || batch.material.tenantId !== tenantId) {
      throw new Error("批次不存在");
    }

    // Re-read after the batch lock. Production completion must hold this same batch lock before it
    // can add MaterialUsage, so this set is stable for the rest of the transaction. If a new order
    // slipped in between the candidate read and the batch lock, fail and let the caller retry
    // rather than taking an order lock after the batch lock (which could deadlock).
    const usages = await tx.materialUsage.findMany({
      where: { batchId },
      include: { task: { select: { orderItem: { select: { orderId: true } } } } },
      orderBy: { id: "asc" },
    });
    const orderIds = [...new Set(
      usages.map((row) => row.task.orderItem.orderId),
    )].sort();
    const lockedOrderIds = new Set(candidateOrderIds);
    if (orderIds.some((orderId) => !lockedOrderIds.has(orderId))) {
      throw new Error("批次用料发生变化，请重试");
    }

    const currentMicros = decimalToMicros(batch.unitCost);
    if (!batch.costEstimated) {
      if (currentMicros !== finalMicros) {
        throw new Error("批次成本已最终确认，不能再次修改");
      }
      return {
        applied: false,
        alreadyFinalized: true,
        batchId,
        previousUnitCost: microsToUnitCost(currentMicros),
        finalUnitCost: microsToUnitCost(currentMicros),
        unitCostDelta: 0,
        openOrders: 0,
        closedOrders: 0,
        costEntriesUpdated: 0,
        adjustmentsCreated: 0,
      };
    }

    const orderRows = orderIds.length === 0 ? [] : await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: { costSnapshots: { orderBy: { revisionNo: "asc" }, take: 1 } },
    });
    if (orderRows.length !== orderIds.length) throw new Error("订单不存在");
    for (const order of orderRows) {
      if (order.tenantId !== tenantId || order.storeId !== storeId) {
        throw new Error("订单归属不一致，需人工处理");
      }
    }

    const usagesByOrder = new Map<string, typeof usages>();
    for (const usage of usages) {
      const orderId = usage.task.orderItem.orderId;
      const rows = usagesByOrder.get(orderId) ?? [];
      rows.push(usage);
      usagesByOrder.set(orderId, rows);
    }

    // Re-read the complete task usage after validation but before any write. For this batch the
    // recalculation below uses the requested final cost directly; other batches keep their stored
    // cost. This keeps the open-order entries correct even if several batches are finalized later.
    const openOrderIds = new Set(
      orderRows.filter((order) => order.costSnapshots.length === 0).map((order) => order.id),
    );
    const openTaskOrder = new Map<string, string>();
    for (const orderId of orderIds) {
      if (!openOrderIds.has(orderId)) continue;
      for (const usage of usagesByOrder.get(orderId) ?? []) {
        openTaskOrder.set(usage.taskId, orderId);
      }
    }
    const openTaskIds = [...openTaskOrder.keys()].sort();
    const openTaskUsages = openTaskIds.length === 0 ? [] : await tx.materialUsage.findMany({
      where: { taskId: { in: openTaskIds } },
      include: { batch: { include: { store: true } } },
      orderBy: { id: "asc" },
    });
    for (const usage of openTaskUsages) {
      if (usage.batch.storeId !== storeId || usage.batch.store.tenantId !== tenantId) {
        throw new Error("订单用料归属不一致，需人工处理");
      }
    }

    await tx.inventoryBatch.update({
      where: { id: batchId },
      data: { unitCost: microsToUnitCostStorage(finalMicros), costEstimated: false },
    });

    const deltaMicros = finalMicros - currentMicros;
    let adjustmentsCreated = 0;
    let costEntriesUpdated = 0;
    let closedOrders = 0;

    // Delivered/closed orders: append signed adjustments to the immutable first snapshot.
    for (const order of orderRows) {
      const snapshot = order.costSnapshots[0];
      if (!snapshot) continue;
      closedOrders += 1;
      let materialMicroMilli = ZERO;
      let lossMicroMilli = ZERO;
      for (const usage of usagesByOrder.get(order.id) ?? []) {
        materialMicroMilli += deltaMicros * quantityToMilli(usage.usedQty);
        lossMicroMilli += deltaMicros * quantityToMilli(usage.lostQty);
      }
      const deltas: [CostKind, bigint][] = [
        [CostKind.MATERIAL, roundToCents(materialMicroMilli)],
        [CostKind.LOSS, roundToCents(lossMicroMilli)],
      ];
      for (const [kind, amountCents] of deltas) {
        if (amountCents === ZERO) continue;
        await tx.costAdjustment.create({
          data: {
            orderId: order.id,
            snapshotId: snapshot.id,
            kind,
            amountDelta: centsToAmount(amountCents),
            reason,
            sourceType: ADJUSTMENT_SOURCE,
            sourceId: batchId,
          },
        });
        adjustmentsCreated += 1;
      }
    }

    // Open orders: recalculate the task's actual MATERIAL and LOSS entries from all of its usage,
    // so finalizing several batches in any order cannot introduce rounding drift.
    const taskUsages = new Map<string, typeof openTaskUsages>();
    for (const usage of openTaskUsages) {
      const rows = taskUsages.get(usage.taskId) ?? [];
      rows.push(usage);
      taskUsages.set(usage.taskId, rows);
    }
    for (const taskId of openTaskIds) {
      const orderId = openTaskOrder.get(taskId);
      if (!orderId) continue;
      const rows = taskUsages.get(taskId) ?? [];
      let materialMicroMilli = ZERO;
      let lossMicroMilli = ZERO;
      let estimated = false;
      for (const usage of rows) {
        // The task query happens before the batch update, so use the requested final cost for this
        // batch and the stored cost for every other batch in the task.
        const isFinalizedBatch = usage.batchId === batchId;
        const unitMicros = isFinalizedBatch ? finalMicros : decimalToMicros(usage.batch.unitCost);
        materialMicroMilli += unitMicros * quantityToMilli(usage.usedQty);
        lossMicroMilli += unitMicros * quantityToMilli(usage.lostQty);
        estimated ||= !isFinalizedBatch && usage.batch.costEstimated;
      }
      const materialCents = roundToCents(materialMicroMilli);
      const lossCents = roundToCents(lossMicroMilli);
      if (await syncCostEntry(tx, {
        orderId, taskId, kind: CostKind.MATERIAL, amountCents: materialCents, estimated,
      })) costEntriesUpdated += 1;
      if (await syncCostEntry(tx, {
        orderId, taskId, kind: CostKind.LOSS, amountCents: lossCents, estimated,
      })) costEntriesUpdated += 1;
    }

    return {
      applied: true,
      alreadyFinalized: false,
      batchId,
      previousUnitCost: microsToUnitCost(currentMicros),
      finalUnitCost: microsToUnitCost(finalMicros),
      unitCostDelta: microsToUnitCost(deltaMicros),
      openOrders: openOrderIds.size,
      closedOrders,
      costEntriesUpdated,
      adjustmentsCreated,
    };
  }, { timeout: 30_000 });
}

/** InventoryBatch.unitCost is Decimal(14, 4). */
function microsToUnitCostStorage(micros: bigint): string {
  const negative = micros < ZERO;
  const absolute = negative ? -micros : micros;
  return `${negative ? "-" : ""}${absolute / TEN_THOUSAND}.${(absolute % TEN_THOUSAND).toString().padStart(4, "0")}`;
}

/** Alias for callers that name the operation after the batch it finalizes. */
export const finalizeInventoryBatchCost = adjustFinalCost;
