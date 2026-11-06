import {
  LossReason, Prisma, TransactionKind,
} from "../../generated/prisma-v2-draft/client";
import {
  assertPositiveQuantity,
  decimalNumber,
  lockBatchBalances,
  lockBatchRow,
  lockStoreRow,
  normalizeScope,
  readBatchAvailability,
  rethrowIdempotencyConflict,
  text,
  type InventoryOperationScope,
} from "./inventory-operations";

export type RecordLossInput = {
  batchId: string;
  locationId: string;
  quantity: number;
  reason: LossReason;
  note?: string | null;
  occurredAt?: Date;
  idempotencyKey: string;
};

export type RecordLossResult = {
  lossRecordId: string;
  transactionId: string;
  batchId: string;
  locationId: string;
  quantity: number;
  baseUnit: string;
  reason: LossReason;
  locationOnHand: number;
  batchAvailableQty: number;
  idempotent: boolean;
};

const LOSS_REFERENCE_TYPE = "LOSS_RECORD";
const LOSS_ACTION = "LOSS_RECORDED";

function lossReasonValid(reason: LossReason): boolean {
  return (Object.values(LossReason) as string[]).includes(reason);
}

function clampNonNegative(value: Prisma.Decimal): number {
  return decimalNumber(value.isNegative() ? new Prisma.Decimal(0) : value);
}

function idempotencyMismatch(): Error {
  return new Error("幂等键已被使用且损耗记录内容不一致，请检查幂等键或换用新的幂等键");
}

/**
 * Records a stock loss for one batch/location and decrements that balance.
 *
 * Availability is the smaller of the batch-level available quantity (on hand minus frozen and
 * active order/sample reservations) and the chosen location's unlocked quantity (on hand minus
 * frozen). The LossRecord, LOSS movement and audit event are written in the caller's transaction.
 * An exact same-key retry returns the existing record and movement without a second decrement.
 */
export async function recordLoss(
  tx: Prisma.TransactionClient,
  scopeInput: InventoryOperationScope,
  input: RecordLossInput,
): Promise<RecordLossResult> {
  const scope = normalizeScope(scopeInput);
  const batchId = text(input.batchId, "库存批次");
  const locationId = text(input.locationId, "库位");
  const idempotencyKey = text(input.idempotencyKey, "幂等键");
  if (!lossReasonValid(input.reason)) {
    throw new Error("损耗原因无效，请选择有效的损耗原因");
  }
  const note = input.note?.trim() || null;
  if (input.occurredAt !== undefined &&
      (!(input.occurredAt instanceof Date) ||
       !Number.isFinite(input.occurredAt.getTime()))) {
    throw new Error("损耗发生时间无效");
  }
  if (!Number.isFinite(input.quantity)) {
    throw new Error("损耗数量必须是有限数字");
  }
  if (input.quantity <= 0) {
    throw new Error("损耗数量必须大于零");
  }

  await lockStoreRow(tx, scope.storeId);
  await lockBatchRow(tx, batchId);
  await lockBatchBalances(tx, batchId);

  const store = await tx.store.findUnique({ where: { id: scope.storeId } });
  if (!store || store.tenantId !== scope.tenantId) {
    throw new Error("门店不存在或不属于当前租户");
  }
  const batch = await tx.inventoryBatch.findUnique({
    where: { id: batchId },
    include: { material: true },
  });
  if (!batch || batch.storeId !== scope.storeId) {
    throw new Error("库存批次不存在或不属于当前门店");
  }
  if (batch.material.tenantId !== scope.tenantId) {
    throw new Error("库存批次物料不属于当前租户");
  }
  const location = await tx.inventoryLocation.findUnique({ where: { id: locationId } });
  if (!location || location.storeId !== scope.storeId) {
    throw new Error("库位不存在或不属于当前门店");
  }

  assertPositiveQuantity(input.quantity, batch.material.quantityScale, "损耗数量");

  const existing = await tx.inventoryTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (existing.kind !== TransactionKind.LOSS ||
        existing.batchId !== batchId ||
        existing.fromLocationId !== locationId ||
        existing.toLocationId !== null ||
        existing.referenceType !== LOSS_REFERENCE_TYPE ||
        !existing.quantity.equals(input.quantity)) {
      throw idempotencyMismatch();
    }
    const lossRecord = await tx.lossRecord.findUnique({
      where: { id: existing.referenceId },
    });
    if (!lossRecord ||
        lossRecord.storeId !== scope.storeId ||
        lossRecord.batchId !== batchId ||
        lossRecord.reason !== input.reason ||
        !lossRecord.quantity.equals(input.quantity) ||
        (lossRecord.note ?? null) !== note ||
        (input.occurredAt !== undefined &&
         lossRecord.occurredAt.getTime() !== input.occurredAt.getTime())) {
      throw idempotencyMismatch();
    }

    const balances = await tx.batchBalance.findMany({
      where: { batchId },
      select: { locationId: true, onHandQty: true },
    });
    const target = balances.find((balance) => balance.locationId === locationId);
    const availability = await readBatchAvailability(tx, batchId);
    return {
      lossRecordId: lossRecord.id,
      transactionId: existing.id,
      batchId,
      locationId,
      quantity: input.quantity,
      baseUnit: batch.material.baseUnit,
      reason: input.reason,
      locationOnHand: decimalNumber(target?.onHandQty),
      batchAvailableQty: clampNonNegative(availability.batchAvailable),
      idempotent: true,
    };
  }

  const balances = await tx.batchBalance.findMany({
    where: { batchId },
    orderBy: { id: "asc" },
  });
  const target = balances.find((balance) => balance.locationId === locationId);
  const locationOnHand = new Prisma.Decimal(target?.onHandQty ?? 0);
  const locationFrozen = new Prisma.Decimal(target?.frozenQty ?? 0);
  const availability = await readBatchAvailability(tx, batchId);
  const locationAvailable = locationOnHand.minus(locationFrozen);
  const available = availability.batchAvailable.lt(locationAvailable)
    ? availability.batchAvailable
    : locationAvailable;

  if (available.lt(input.quantity)) {
    throw new Error(
      `损耗数量超过可用库存：当前可用 ${clampNonNegative(available)}${batch.material.baseUnit}，` +
      `本次损耗 ${input.quantity}${batch.material.baseUnit}`,
    );
  }
  if (!target) {
    throw new Error("库位没有可用的库存余额，不能登记损耗");
  }

  const nextOnHand = locationOnHand.minus(input.quantity);
  if (nextOnHand.isNegative()) {
    throw new Error("损耗后库位库存不能为负数");
  }
  const occurredAt = input.occurredAt ?? new Date();

  await tx.batchBalance.update({
    where: { id: target.id },
    data: { onHandQty: nextOnHand },
  });
  const lossRecord = await tx.lossRecord.create({
    data: {
      storeId: scope.storeId,
      batchId,
      reason: input.reason,
      quantity: input.quantity,
      note,
      occurredAt,
    },
  });
  const transaction = await tx.inventoryTransaction.create({
    data: {
      batchId,
      kind: TransactionKind.LOSS,
      quantity: input.quantity,
      fromLocationId: locationId,
      toLocationId: null,
      referenceType: LOSS_REFERENCE_TYPE,
      referenceId: lossRecord.id,
      idempotencyKey,
    },
  }).catch((error: unknown) => rethrowIdempotencyConflict(error));

  const nextBatchAvailable = availability.batchAvailable.minus(input.quantity);
  const auditBase = {
    lossRecordId: lossRecord.id,
    batchId,
    batchNo: batch.batchNo,
    locationId,
    quantity: input.quantity,
    baseUnit: batch.material.baseUnit,
    reason: input.reason,
    note,
    occurredAt: occurredAt.toISOString(),
    idempotencyKey,
  };
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: LOSS_ACTION,
      entityType: "LossRecord",
      entityId: lossRecord.id,
      beforeSnapshot: {
        ...auditBase,
        locationOnHand: decimalNumber(locationOnHand),
        batchAvailableQty: clampNonNegative(availability.batchAvailable),
      },
      afterSnapshot: {
        ...auditBase,
        locationOnHand: decimalNumber(nextOnHand),
        batchAvailableQty: clampNonNegative(nextBatchAvailable),
      },
    },
  });

  return {
    lossRecordId: lossRecord.id,
    transactionId: transaction.id,
    batchId,
    locationId,
    quantity: input.quantity,
    baseUnit: batch.material.baseUnit,
    reason: input.reason,
    locationOnHand: decimalNumber(nextOnHand),
    batchAvailableQty: clampNonNegative(nextBatchAvailable),
    idempotent: false,
  };
}
