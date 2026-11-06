import {
  Prisma, StocktakeState, TransactionKind,
} from "../../generated/prisma-v2-draft/client";
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
  lines: ConfirmStocktakeLineResult[];
  adjustmentCount: number;
};

const MAX_STOCKTAKE_LINES = 100;
const STOCKTAKE_CREATED_ACTION = "STOCKTAKE_DRAFT_CREATED";
const STOCKTAKE_CONFIRMED_ACTION = "STOCKTAKE_CONFIRMED";
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

  const confirmedAt = new Date();
  await tx.stocktake.update({
    where: { id: stocktake.id },
    data: { state: StocktakeState.CONFIRMED, confirmedAt },
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
