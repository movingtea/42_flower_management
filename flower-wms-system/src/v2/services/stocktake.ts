import {
  Prisma, ReservationState, StocktakeState, SupplyState, TransactionKind,
} from "../../generated/prisma-v2/client";
import { assertMaterialQuantity } from "../domain/stock-planning";
import {
  assertNonNegativeQuantity,
  decimalNumber,
  deterministicId,
  lockBatchBalances,
  lockBatchRow,
  lockStoreRow,
  normalizeScope,
  text,
  type InventoryOperationScope,
} from "./inventory-operations";

export type CreateStocktakeDraftInput = {
  idempotencyKey: string;
  lines: Array<{ batchId: string; locationId: string; countedQty: number; reason?: string }>;
};

export type StocktakeDraftResult = {
  stocktakeId: string;
  lineCount: number;
  totalRecordedQty: number;
  totalCountedQty: number;
  totalDifferenceQty: number;
  idempotent: boolean;
};

export type ConfirmStocktakeLineResult = {
  lineId: string;
  batchId: string;
  locationId: string;
  recordedQty: number;
  countedQty: number;
  differenceQty: number;
  adjustmentQty: number;
  transactionId: string | null;
};

export type ConfirmStocktakeResult = {
  stocktakeId: string;
  alreadyConfirmed: boolean;
  pendingReview?: boolean;
  reviewReasons?: string[];
  lines: ConfirmStocktakeLineResult[];
  adjustmentCount: number;
};

const MAX_STOCKTAKE_LINES = 100;
const STOCKTAKE_CREATED_ACTION = "STOCKTAKE_DRAFT_CREATED";
const STOCKTAKE_CONFIRMED_ACTION = "STOCKTAKE_CONFIRMED";
const STOCKTAKE_REVIEW_REQUESTED_ACTION = "STOCKTAKE_REVIEW_REQUESTED";
const STOCKTAKE_LINE_REFERENCE_TYPE = "STOCKTAKE_LINE";

type DraftLine = {
  batchId: string;
  locationId: string;
  countedQty: number;
  reason: string | null;
};

type StocktakeSummary = {
  totalRecordedQty: number;
  totalCountedQty: number;
  totalDifferenceQty: number;
};

function summarizeLines(
  lines: readonly { recordedQty: Prisma.Decimal; countedQty: Prisma.Decimal }[],
): StocktakeSummary {
  let recorded = new Prisma.Decimal(0);
  let counted = new Prisma.Decimal(0);
  for (const line of lines) {
    recorded = recorded.plus(line.recordedQty);
    counted = counted.plus(line.countedQty);
  }
  return {
    totalRecordedQty: decimalNumber(recorded),
    totalCountedQty: decimalNumber(counted),
    totalDifferenceQty: decimalNumber(counted.minus(recorded)),
  };
}

function normalizeDraftLines(
  inputLines: CreateStocktakeDraftInput["lines"],
): DraftLine[] {
  if (!Array.isArray(inputLines) ||
      inputLines.length < 1 ||
      inputLines.length > MAX_STOCKTAKE_LINES) {
    throw new Error(`盘点明细必须为 1 到 ${MAX_STOCKTAKE_LINES} 行`);
  }
  const seen = new Set<string>();
  return inputLines.map((line) => {
    const batchId = text(line?.batchId, "库存批次");
    const locationId = text(line?.locationId, "库位");
    const pair = `${batchId}:${locationId}`;
    if (seen.has(pair)) {
      throw new Error("盘点明细存在重复的批次和库位");
    }
    seen.add(pair);
    if (!Number.isFinite(line.countedQty)) {
      throw new Error("盘点数量必须是有限数字");
    }
    if (line.countedQty < 0) {
      throw new Error("盘点数量不能为负数");
    }
    return {
      batchId,
      locationId,
      countedQty: line.countedQty,
      reason: line.reason?.trim() || null,
    };
  });
}

function stocktakeIdFor(idempotencyKey: string): string {
  // Deterministic id makes an exact create retry return the same draft without any second write.
  return deterministicId("st", `stocktake:${idempotencyKey}`);
}

function confirmKey(stocktakeId: string, lineId: string): string {
  return `STOCKTAKE:${stocktakeId}:${lineId}`;
}

async function isInventoryReviewer(
  tx: Prisma.TransactionClient,
  scope: InventoryOperationScope,
): Promise<boolean> {
  const membership = await tx.storeMember.findFirst({
    where: { staffUserId: scope.actorStaffId, storeId: scope.storeId, active: true },
    include: { staffUser: { include: { tenantMembers: true } } },
  });
  if (!membership) return false;
  const tenantMember = membership.staffUser.tenantMembers.find(
    (row) => row.tenantId === scope.tenantId && row.active,
  );
  if (!tenantMember) return false;
  const roles = new Set([...membership.roles, ...tenantMember.roles]);
  return roles.has("ADMIN") || roles.has("MANAGER") || roles.has("INVENTORY_REVIEWER");
}

const ORDER_LOCK_RETRY_MESSAGE = "盘点影响的订单正在被其他操作处理，请稍后重试";

type DeficientBatchRisk = {
  batchId: string;
  onHandQty: number;
  activeReservationQty: number;
  shortageQty: number;
};

type SupplyRiskResult = {
  deficientBatches: DeficientBatchRisk[];
  affectedOrderIds: string[];
};

/**
 * A NOWAIT order lock is expected to fail fast when another transaction holds the order row.
 * Only Prisma's raw-query wrapper (P2010) carrying SQLSTATE 55P03 is translated; every other
 * database or Prisma error keeps its original meaning.
 */
function isOrderLockUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  if (candidate.code !== "P2010") return false;
  const sqlState = typeof candidate.meta?.code === "string" ? candidate.meta.code : null;
  const detail = typeof candidate.meta?.message === "string"
    ? candidate.meta.message
    : typeof candidate.message === "string"
      ? candidate.message
      : "";
  return sqlState === "55P03" ||
    detail.includes("55P03") ||
    detail.includes("could not obtain lock");
}

/**
 * Locks affected orders in id order without waiting, so a stocktake already holding batch locks
 * can never complete a deadlock cycle with an order-first writer. A concurrent order transaction
 * makes the stocktake fail fast and be retried instead of waiting.
 */
async function lockAffectedOrders(
  tx: Prisma.TransactionClient,
  scope: InventoryOperationScope,
  orderIds: readonly string[],
): Promise<void> {
  if (orderIds.length === 0) return;
  try {
    await tx.$queryRaw`
      SELECT id FROM "Order"
      WHERE id IN (${Prisma.join([...orderIds])})
        AND "tenantId" = ${scope.tenantId}
        AND "storeId" = ${scope.storeId}
      ORDER BY id
      FOR UPDATE NOWAIT
    `;
  } catch (error) {
    if (isOrderLockUnavailable(error)) {
      throw new Error(ORDER_LOCK_RETRY_MESSAGE);
    }
    throw error;
  }
}

/**
 * Detects batches where the final post-adjustment on-hand total is below their active order
 * reservations. All batch locations count, including locations without a stocktake line.
 * Only ACTIVE reservations on the order's current revision are counted; historical ACTIVE rows
 * and other store/tenant records cannot create or widen a supply risk. Fully covered orders are
 * collected without applying a loss-allocation priority, which was not authorized for this
 * work package.
 */
async function evaluateSupplyRisk(
  tx: Prisma.TransactionClient,
  scope: InventoryOperationScope,
  batchIds: readonly string[],
): Promise<SupplyRiskResult> {
  const balances = await tx.batchBalance.groupBy({
    by: ["batchId"],
    where: { batchId: { in: [...batchIds] } },
    _sum: { onHandQty: true },
  });
  const onHandByBatch = new Map(
    balances.map((balance) => [
      balance.batchId,
      new Prisma.Decimal(balance._sum.onHandQty ?? 0),
    ]),
  );

  const reservations = await tx.inventoryReservation.findMany({
    where: {
      batchId: { in: [...batchIds] },
      state: ReservationState.ACTIVE,
      quantity: { gt: 0 },
      requirement: {
        orderItem: {
          order: {
            tenantId: scope.tenantId,
            storeId: scope.storeId,
          },
        },
      },
    },
    select: {
      batchId: true,
      quantity: true,
      requirement: {
        select: {
          revision: {
            select: { orderId: true, number: true },
          },
          orderItem: {
            select: {
              order: {
                select: { id: true, version: true, supplyState: true },
              },
            },
          },
        },
      },
    },
  });

  // An ACTIVE row from a superseded revision is historical, not a current reservation. Both the
  // batch total and the affected-order set use only reservations whose revision is the order's
  // current revision and whose revision belongs to that same order.
  const currentReservations = reservations.filter((reservation) => {
    const order = reservation.requirement.orderItem.order;
    return reservation.requirement.revision.orderId === order.id &&
      reservation.requirement.revision.number === order.version;
  });

  const reservedByBatch = new Map<string, Prisma.Decimal>();
  for (const reservation of currentReservations) {
    const current = reservedByBatch.get(reservation.batchId) ?? new Prisma.Decimal(0);
    reservedByBatch.set(reservation.batchId, current.plus(reservation.quantity));
  }

  const deficientBatchIds = new Set<string>();
  const deficientBatches: DeficientBatchRisk[] = [];
  for (const batchId of batchIds) {
    const onHand = onHandByBatch.get(batchId) ?? new Prisma.Decimal(0);
    const reserved = reservedByBatch.get(batchId) ?? new Prisma.Decimal(0);
    if (!onHand.lt(reserved)) continue;
    deficientBatchIds.add(batchId);
    deficientBatches.push({
      batchId,
      onHandQty: decimalNumber(onHand),
      activeReservationQty: decimalNumber(reserved),
      shortageQty: decimalNumber(reserved.minus(onHand)),
    });
  }

  const affectedOrderIds = new Set<string>();
  for (const reservation of currentReservations) {
    if (!deficientBatchIds.has(reservation.batchId)) continue;
    const order = reservation.requirement.orderItem.order;
    if (order.supplyState === SupplyState.ON_HAND_COVERED) {
      affectedOrderIds.add(order.id);
    }
  }

  return {
    deficientBatches,
    affectedOrderIds: [...affectedOrderIds].sort(),
  };
}

/**
 * Takes the initial risk snapshot, locks its candidate orders without waiting, then re-reads the
 * risk while those order rows are held. Cancellation can release reservations without taking a
 * batch lock, so the re-read is required before any order status is changed or audited. If the
 * re-read nominates an order that was not locked, it is locked and the snapshot is re-read again.
 */
async function lockAndRevalidateSupplyRisk(
  tx: Prisma.TransactionClient,
  scope: InventoryOperationScope,
  batchIds: readonly string[],
): Promise<SupplyRiskResult> {
  const lockedOrderIds = new Set<string>();
  let supplyRisk = await evaluateSupplyRisk(tx, scope, batchIds);

  while (supplyRisk.affectedOrderIds.length > 0) {
    const unlockedOrderIds = supplyRisk.affectedOrderIds.filter(
      (orderId) => !lockedOrderIds.has(orderId),
    );
    if (unlockedOrderIds.length === 0) break;
    await lockAffectedOrders(tx, scope, unlockedOrderIds);
    for (const orderId of unlockedOrderIds) lockedOrderIds.add(orderId);
    supplyRisk = await evaluateSupplyRisk(tx, scope, batchIds);
  }

  return supplyRisk;
}

/**
 * Creates a DRAFT stocktake with an immutable snapshot of current on-hand quantities.
 * No inventory balance, transaction or audit is written for the counted quantities themselves.
 *
 * The deterministic id derived from the idempotency key makes an exact retry a pure read. Draft
 * creation locks Store -> sorted batches -> sorted balance rows before reading the snapshot, using
 * the same order as every other inventory writer.
 */
export async function createStocktakeDraft(
  tx: Prisma.TransactionClient,
  scopeInput: InventoryOperationScope,
  input: CreateStocktakeDraftInput,
): Promise<StocktakeDraftResult> {
  const scope = normalizeScope(scopeInput);
  const idempotencyKey = text(input.idempotencyKey, "幂等键");
  const lines = normalizeDraftLines(input.lines);
  const stocktakeId = stocktakeIdFor(idempotencyKey);

  const existing = await tx.stocktake.findUnique({
    where: { id: stocktakeId },
    include: { lines: true, store: true },
  });
  if (existing) {
    if (existing.storeId !== scope.storeId ||
        existing.store.tenantId !== scope.tenantId) {
      throw new Error("幂等键对应的盘点单不属于当前门店");
    }
    const matches = existing.lines.length === lines.length && lines.every((line) => {
      const row = existing.lines.find(
        (candidate) =>
          candidate.batchId === line.batchId && candidate.locationId === line.locationId,
      );
      return Boolean(
        row &&
        row.countedQty.equals(line.countedQty) &&
        (row.reason ?? null) === line.reason,
      );
    });
    if (!matches) {
      throw new Error("幂等键对应的盘点单与本次请求不一致，请检查幂等键");
    }
    return {
      stocktakeId,
      lineCount: existing.lines.length,
      ...summarizeLines(existing.lines),
      idempotent: true,
    };
  }

  await lockStoreRow(tx, scope.storeId);
  const store = await tx.store.findUnique({ where: { id: scope.storeId } });
  if (!store || store.tenantId !== scope.tenantId) {
    throw new Error("门店不存在或不属于当前租户");
  }

  const batchIds = [...new Set(lines.map((line) => line.batchId))].sort();
  const locationIds = [...new Set(lines.map((line) => line.locationId))];

  for (const batchId of batchIds) {
    await lockBatchRow(tx, batchId);
  }
  for (const batchId of batchIds) {
    await lockBatchBalances(tx, batchId);
  }

  const batches = await tx.inventoryBatch.findMany({
    where: { id: { in: batchIds } },
    include: { material: true },
  });
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  for (const batchId of batchIds) {
    const batch = batchById.get(batchId);
    if (!batch || batch.storeId !== scope.storeId) {
      throw new Error("库存批次不存在或不属于当前门店");
    }
    if (batch.material.tenantId !== scope.tenantId) {
      throw new Error("库存批次物料不属于当前租户");
    }
  }

  const locations = await tx.inventoryLocation.findMany({
    where: { id: { in: locationIds } },
  });
  const locationById = new Map(locations.map((location) => [location.id, location]));
  for (const locationId of locationIds) {
    const location = locationById.get(locationId);
    if (!location || location.storeId !== scope.storeId) {
      throw new Error("库位不存在或不属于当前门店");
    }
  }

  for (const line of lines) {
    const batch = batchById.get(line.batchId);
    if (!batch) throw new Error("库存批次不存在或不属于当前门店");
    assertNonNegativeQuantity(
      line.countedQty,
      batch.material.quantityScale,
      "盘点数量",
    );
  }

  const balances = await tx.batchBalance.findMany({
    where: { batchId: { in: batchIds } },
  });
  const balanceByPair = new Map(
    balances.map((balance) => [`${balance.batchId}:${balance.locationId}`, balance]),
  );

  const stocktake = await tx.stocktake.create({
    data: {
      id: stocktakeId,
      storeId: scope.storeId,
      lines: {
        create: lines.map((line) => ({
          batchId: line.batchId,
          locationId: line.locationId,
          countedQty: line.countedQty,
          recordedQty:
            balanceByPair.get(`${line.batchId}:${line.locationId}`)?.onHandQty ?? 0,
          reason: line.reason,
        })),
      },
    },
    include: { lines: true },
  });
  const summary = summarizeLines(stocktake.lines);

  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: STOCKTAKE_CREATED_ACTION,
      entityType: "Stocktake",
      entityId: stocktake.id,
      afterSnapshot: {
        stocktakeId: stocktake.id,
        state: stocktake.state,
        lineCount: stocktake.lines.length,
        ...summary,
        idempotencyKey,
        lines: stocktake.lines.map((line) => ({
          lineId: line.id,
          batchId: line.batchId,
          locationId: line.locationId,
          recordedQty: decimalNumber(line.recordedQty),
          countedQty: decimalNumber(line.countedQty),
          reason: line.reason,
        })),
      },
    },
  });

  return {
    stocktakeId: stocktake.id,
    lineCount: stocktake.lines.length,
    ...summary,
    idempotent: false,
  };
}

function signedAdjustmentQty(
  transaction: {
    quantity: Prisma.Decimal;
    fromLocationId: string | null;
    toLocationId: string | null;
  } | null,
  locationId: string,
): number {
  if (!transaction) return 0;
  const quantity = decimalNumber(transaction.quantity);
  if (transaction.fromLocationId === locationId) return -quantity;
  if (transaction.toLocationId === locationId) return quantity;
  return 0;
}

/**
 * Confirms a stocktake exactly once.
 *
 * The Stocktake row is locked first, so a repeated or concurrent confirm sees CONFIRMED and only
 * reads the existing deterministic movements. On the first confirm each line compares counted
 * quantity with the current locked balance; only a real difference writes the balance and one
 * ADJUSTMENT movement. Counted quantity can never be negative and the balance is set to it.
 */
export async function confirmStocktake(
  tx: Prisma.TransactionClient,
  scopeInput: InventoryOperationScope,
  stocktakeIdInput: string,
  reviewApproval?: { approved: true; note?: string },
): Promise<ConfirmStocktakeResult> {
  const scope = normalizeScope(scopeInput);
  const stocktakeId = text(stocktakeIdInput, "盘点单");

  await tx.$queryRaw`SELECT id FROM "Stocktake" WHERE id = ${stocktakeId} FOR UPDATE`;
  const stocktake = await tx.stocktake.findUnique({
    where: { id: stocktakeId },
    include: {
      store: true,
      lines: { orderBy: { id: "asc" } },
    },
  });
  if (!stocktake ||
      stocktake.storeId !== scope.storeId ||
      stocktake.store.tenantId !== scope.tenantId) {
    throw new Error("盘点单不存在或不属于当前门店");
  }
  if (stocktake.state === StocktakeState.CANCELLED) {
    throw new Error("盘点单已取消，不能确认");
  }
  if (stocktake.state === StocktakeState.REJECTED) {
    throw new Error("盘点单复核已拒绝，不能确认");
  }
  if (stocktake.state === StocktakeState.PENDING_REVIEW && !reviewApproval?.approved) {
    throw new Error("盘点单正在等待本店经理或授权人员复核");
  }
  if (stocktake.state === StocktakeState.CONFIRMED) {
    const keys = stocktake.lines.map((line) => confirmKey(stocktake.id, line.id));
    const transactions = await tx.inventoryTransaction.findMany({
      where: { idempotencyKey: { in: keys } },
    });
    const transactionByKey = new Map(
      transactions.map((transaction) => [transaction.idempotencyKey, transaction]),
    );
    const lines = stocktake.lines.map((line) => {
      const transaction = transactionByKey.get(confirmKey(stocktake.id, line.id)) ?? null;
      if (transaction &&
          (transaction.batchId !== line.batchId ||
           transaction.referenceType !== STOCKTAKE_LINE_REFERENCE_TYPE ||
           transaction.referenceId !== line.id)) {
        throw new Error("盘点单调整流水与明细不一致，需人工处理");
      }
      return {
        lineId: line.id,
        batchId: line.batchId,
        locationId: line.locationId,
        recordedQty: decimalNumber(line.recordedQty),
        countedQty: decimalNumber(line.countedQty),
        differenceQty: decimalNumber(
          new Prisma.Decimal(line.countedQty).minus(line.recordedQty),
        ),
        adjustmentQty: signedAdjustmentQty(transaction, line.locationId),
        transactionId: transaction?.id ?? null,
      };
    });
    return {
      stocktakeId: stocktake.id,
      alreadyConfirmed: true,
      lines,
      adjustmentCount: lines.filter((line) => line.transactionId !== null).length,
    };
  }
  if (stocktake.lines.length === 0) {
    throw new Error("盘点单没有明细，不能确认");
  }

  await lockStoreRow(tx, scope.storeId);
  const store = await tx.store.findUnique({ where: { id: scope.storeId } });
  if (!store || store.tenantId !== scope.tenantId) {
    throw new Error("门店不存在或不属于当前租户");
  }

  const batchIds = [...new Set(stocktake.lines.map((line) => line.batchId))].sort();
  const locationIds = [...new Set(stocktake.lines.map((line) => line.locationId))];
  for (const batchId of batchIds) {
    await lockBatchRow(tx, batchId);
  }
  for (const batchId of batchIds) {
    await lockBatchBalances(tx, batchId);
  }

  const batches = await tx.inventoryBatch.findMany({
    where: { id: { in: batchIds } },
    include: { material: true },
  });
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  for (const batchId of batchIds) {
    const batch = batchById.get(batchId);
    if (!batch || batch.storeId !== scope.storeId) {
      throw new Error("盘点批次不存在或不属于当前门店");
    }
    if (batch.material.tenantId !== scope.tenantId) {
      throw new Error("盘点批次物料不属于当前租户");
    }
  }
  const locations = await tx.inventoryLocation.findMany({
    where: { id: { in: locationIds } },
  });
  const locationById = new Map(locations.map((location) => [location.id, location]));
  for (const locationId of locationIds) {
    const location = locationById.get(locationId);
    if (!location || location.storeId !== scope.storeId) {
      throw new Error("盘点库位不存在或不属于当前门店");
    }
  }

  const balances = await tx.batchBalance.findMany({
    where: { batchId: { in: batchIds } },
  });
  const balanceByPair = new Map(
    balances.map((balance) => [`${balance.batchId}:${balance.locationId}`, balance]),
  );

  const projectedByBatch = new Map<string, Prisma.Decimal>();
  for (const balance of balances) {
    projectedByBatch.set(
      balance.batchId,
      (projectedByBatch.get(balance.batchId) ?? new Prisma.Decimal(0)).plus(balance.onHandQty),
    );
  }
  const reviewReasons = new Set<string>();
  const settings = await tx.storeSettings.findUnique({ where: { storeId: scope.storeId } });
  for (const line of stocktake.lines) {
    const current = new Prisma.Decimal(balanceByPair.get(`${line.batchId}:${line.locationId}`)?.onHandQty ?? 0);
    const difference = new Prisma.Decimal(line.countedQty).minus(current);
    projectedByBatch.set(
      line.batchId,
      (projectedByBatch.get(line.batchId) ?? new Prisma.Decimal(0)).plus(difference),
    );
    if (settings && difference.abs().gt(settings.lossReviewThreshold)) {
      reviewReasons.add("盘点差异超过门店阈值");
    }
  }
  const activeReservations = await tx.inventoryReservation.findMany({
    where: {
      batchId: { in: batchIds }, state: ReservationState.ACTIVE, quantity: { gt: 0 },
      requirement: { orderItem: { order: { tenantId: scope.tenantId, storeId: scope.storeId } } },
    },
    select: {
      batchId: true, quantity: true,
      requirement: { select: {
        revision: { select: { orderId: true, number: true } },
        orderItem: { select: { order: { select: { id: true, version: true } } } },
      } },
    },
  });
  const reservedByBatch = new Map<string, Prisma.Decimal>();
  for (const reservation of activeReservations) {
    const order = reservation.requirement.orderItem.order;
    if (reservation.requirement.revision.orderId !== order.id ||
        reservation.requirement.revision.number !== order.version) continue;
    reservedByBatch.set(
      reservation.batchId,
      (reservedByBatch.get(reservation.batchId) ?? new Prisma.Decimal(0)).plus(reservation.quantity),
    );
  }
  if (batchIds.some((batchId) =>
    (projectedByBatch.get(batchId) ?? new Prisma.Decimal(0))
      .lt(reservedByBatch.get(batchId) ?? new Prisma.Decimal(0)))) {
    reviewReasons.add("盘亏影响订单预留");
  }

  const reviewer = await isInventoryReviewer(tx, scope);
  if (reviewApproval?.approved && !reviewer) {
    throw new Error("仅本店经理或授权人员可以复核盘点差异");
  }
  if (reviewReasons.size > 0 && !reviewer && stocktake.state === StocktakeState.DRAFT) {
    const reasons = [...reviewReasons];
    await tx.stocktake.update({ where: { id: stocktake.id }, data: {
      state: StocktakeState.PENDING_REVIEW,
      reviewReasons: reasons,
      submittedById: scope.actorStaffId,
    } });
    await tx.auditEvent.create({ data: {
      tenantId: scope.tenantId, storeId: scope.storeId, actorStaffId: scope.actorStaffId,
      action: STOCKTAKE_REVIEW_REQUESTED_ACTION, entityType: "Stocktake", entityId: stocktake.id,
      beforeSnapshot: { state: stocktake.state },
      afterSnapshot: { state: StocktakeState.PENDING_REVIEW, reviewReasons: reasons },
    } });
    return { stocktakeId: stocktake.id, alreadyConfirmed: false, pendingReview: true,
      reviewReasons: reasons, lines: [], adjustmentCount: 0 };
  }

  const confirmedLines: ConfirmStocktakeLineResult[] = [];
  const auditLines: Array<{
    lineId: string;
    batchId: string;
    locationId: string;
    currentOnHand: number;
    countedQty: number;
    adjustmentQty: number;
    transactionId: string | null;
  }> = [];
  for (const line of stocktake.lines) {
    const batch = batchById.get(line.batchId);
    if (!batch) throw new Error("盘点批次不存在或不属于当前门店");
    const countedQty = new Prisma.Decimal(line.countedQty);
    if (countedQty.isNegative()) {
      throw new Error("盘点数量不能为负数");
    }
    try {
      assertMaterialQuantity(decimalNumber(countedQty), batch.material.quantityScale);
    } catch {
      throw new Error("盘点数量必须符合物料计量精度");
    }

    const balance = balanceByPair.get(`${line.batchId}:${line.locationId}`);
    const currentOnHand = new Prisma.Decimal(balance?.onHandQty ?? 0);
    const difference = countedQty.minus(currentOnHand);
    let transactionId: string | null = null;

    if (!difference.isZero()) {
      const balanceKey = {
        batchId_locationId: {
          batchId: line.batchId,
          locationId: line.locationId,
        },
      };
      await tx.batchBalance.upsert({
        where: balanceKey,
        create: {
          batchId: line.batchId,
          locationId: line.locationId,
          onHandQty: countedQty,
        },
        update: { onHandQty: countedQty },
      });

      const idempotencyKey = confirmKey(stocktake.id, line.id);
      const prior = await tx.inventoryTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (prior) {
        throw new Error("盘点明细已存在调整流水，盘点单状态异常，需人工处理");
      }
      const transaction = await tx.inventoryTransaction.create({
        data: {
          batchId: line.batchId,
          kind: TransactionKind.ADJUSTMENT,
          quantity: difference.abs(),
          fromLocationId: difference.isNegative() ? line.locationId : null,
          toLocationId: difference.isPositive() ? line.locationId : null,
          referenceType: STOCKTAKE_LINE_REFERENCE_TYPE,
          referenceId: line.id,
          idempotencyKey,
        },
      });
      transactionId = transaction.id;
    }

    confirmedLines.push({
      lineId: line.id,
      batchId: line.batchId,
      locationId: line.locationId,
      recordedQty: decimalNumber(line.recordedQty),
      countedQty: decimalNumber(countedQty),
      differenceQty: decimalNumber(new Prisma.Decimal(line.countedQty).minus(line.recordedQty)),
      adjustmentQty: decimalNumber(difference),
      transactionId,
    });
    auditLines.push({
      lineId: line.id,
      batchId: line.batchId,
      locationId: line.locationId,
      currentOnHand: decimalNumber(currentOnHand),
      countedQty: decimalNumber(countedQty),
      adjustmentQty: decimalNumber(difference),
      transactionId,
    });
  }

  const supplyRisk = await lockAndRevalidateSupplyRisk(tx, scope, batchIds);
  if (supplyRisk.affectedOrderIds.length > 0) {
    await tx.order.updateMany({
      where: {
        id: { in: supplyRisk.affectedOrderIds },
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        supplyState: SupplyState.ON_HAND_COVERED,
      },
      data: { supplyState: SupplyState.PARTIALLY_COVERED },
    });
  }

  const confirmedAt = new Date();
  await tx.stocktake.update({
    where: { id: stocktake.id },
    data: {
      state: StocktakeState.CONFIRMED, confirmedAt,
      submittedById: stocktake.submittedById ?? scope.actorStaffId,
      reviewedById: stocktake.state === StocktakeState.PENDING_REVIEW || reviewReasons.size > 0
        ? scope.actorStaffId : null,
      reviewedAt: stocktake.state === StocktakeState.PENDING_REVIEW || reviewReasons.size > 0
        ? confirmedAt : null,
      reviewNote: reviewApproval?.note?.trim() || null,
      reviewReasons: stocktake.reviewReasons.length ? stocktake.reviewReasons : [...reviewReasons],
    },
  });
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: STOCKTAKE_CONFIRMED_ACTION,
      entityType: "Stocktake",
      entityId: stocktake.id,
      beforeSnapshot: {
        stocktakeId: stocktake.id,
        state: stocktake.state,
        lines: stocktake.lines.map((line) => ({
          lineId: line.id,
          batchId: line.batchId,
          locationId: line.locationId,
          recordedQty: decimalNumber(line.recordedQty),
          countedQty: decimalNumber(line.countedQty),
        })),
      },
      afterSnapshot: {
        stocktakeId: stocktake.id,
        state: StocktakeState.CONFIRMED,
        confirmedAt: confirmedAt.toISOString(),
        adjustmentCount: confirmedLines.filter((line) => line.transactionId !== null).length,
        lines: auditLines,
        supplyRisk: {
          deficientBatches: supplyRisk.deficientBatches,
          affectedOrderIds: supplyRisk.affectedOrderIds,
        },
      },
    },
  });

  return {
    stocktakeId: stocktake.id,
    alreadyConfirmed: false,
    lines: confirmedLines,
    adjustmentCount: confirmedLines.filter((line) => line.transactionId !== null).length,
  };
}

export async function reviewStocktake(
  tx: Prisma.TransactionClient,
  scope: InventoryOperationScope,
  stocktakeId: string,
  decision: "APPROVE" | "REJECT",
  note: string,
): Promise<ConfirmStocktakeResult> {
  const cleanNote = note?.trim();
  if (!cleanNote) throw new Error("复核意见必填");
  const normalized = normalizeScope(scope);
  if (!await isInventoryReviewer(tx, normalized)) {
    throw new Error("仅本店经理或授权人员可以复核盘点差异");
  }
  if (decision === "APPROVE") {
    return confirmStocktake(tx, normalized, stocktakeId, { approved: true, note: cleanNote });
  }
  await tx.$queryRaw`SELECT id FROM "Stocktake" WHERE id = ${stocktakeId} FOR UPDATE`;
  const stocktake = await tx.stocktake.findFirst({
    where: { id: stocktakeId, storeId: normalized.storeId, store: { tenantId: normalized.tenantId } },
  });
  if (!stocktake) throw new Error("盘点单不存在或不属于当前门店");
  if (stocktake.state !== StocktakeState.PENDING_REVIEW) throw new Error("盘点单当前不在待复核状态");
  const reviewedAt = new Date();
  await tx.stocktake.update({ where: { id: stocktake.id }, data: {
    state: StocktakeState.REJECTED, reviewedById: normalized.actorStaffId, reviewedAt,
    reviewNote: cleanNote,
  } });
  await tx.auditEvent.create({ data: {
    tenantId: normalized.tenantId, storeId: normalized.storeId,
    actorStaffId: normalized.actorStaffId, action: "STOCKTAKE_REVIEW_REJECTED",
    entityType: "Stocktake", entityId: stocktake.id,
    beforeSnapshot: { state: StocktakeState.PENDING_REVIEW },
    afterSnapshot: { state: StocktakeState.REJECTED, reviewNote: cleanNote },
  } });
  return { stocktakeId, alreadyConfirmed: false, pendingReview: false, lines: [], adjustmentCount: 0 };
}
