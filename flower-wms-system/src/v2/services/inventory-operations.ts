import { createHash } from "node:crypto";
import {
  Prisma, ReservationState, TransactionKind,
} from "../../generated/prisma-v2-draft/client";
import { assertMaterialQuantity } from "../domain/stock-planning";

export type InventoryOperationScope = {
  tenantId: string;
  storeId: string;
  actorStaffId: string;
};

export type AdjustInventoryInput = {
  batchId: string;
  locationId: string;
  mode: "INCREASE" | "DECREASE";
  quantity: number;
  reason: string;
  idempotencyKey: string;
};

export type InventoryAdjustmentResult = {
  transactionId: string;
  batchId: string;
  locationId: string;
  mode: "INCREASE" | "DECREASE";
  quantity: number;
  locationOnHand: number;
  batchOnHand: number;
  idempotent: boolean;
};

export type TransferInventoryInput = {
  batchId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  reason?: string;
  idempotencyKey: string;
};

export type InventoryTransferResult = {
  transactionId: string;
  batchId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  fromOnHand: number;
  toOnHand: number;
  batchOnHand: number;
  idempotent: boolean;
};

const ADJUSTMENT_REFERENCE_TYPE = "INVENTORY_ADJUSTMENT";
const TRANSFER_REFERENCE_TYPE = "INVENTORY_TRANSFER";
const ADJUSTMENT_ACTION = "INVENTORY_ADJUSTED";
const TRANSFER_ACTION = "INVENTORY_TRANSFERRED";

export function text(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  return trimmed;
}

/** Validates the authenticated scope once, so no store-bound operation trusts form ids. */
export function normalizeScope(scope: InventoryOperationScope): InventoryOperationScope {
  return {
    tenantId: text(scope?.tenantId, "租户"),
    storeId: text(scope?.storeId, "门店"),
    actorStaffId: text(scope?.actorStaffId, "操作员工"),
  };
}

export function decimalNumber(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

/** Positive mutation quantity: finite, strictly greater than zero and on the material scale. */
export function assertPositiveQuantity(
  quantity: number,
  quantityScale: number,
  label = "数量",
): void {
  if (!Number.isFinite(quantity)) throw new Error(`${label}必须是有限数字`);
  if (quantity <= 0) throw new Error(`${label}必须大于零`);
  try {
    assertMaterialQuantity(quantity, quantityScale);
  } catch {
    throw new Error(`${label}必须符合物料计量精度`);
  }
}

/** Nonnegative counted quantity: a stocktake line may legitimately count zero. */
export function assertNonNegativeQuantity(
  quantity: number,
  quantityScale: number,
  label = "数量",
): void {
  if (!Number.isFinite(quantity)) throw new Error(`${label}必须是有限数字`);
  if (quantity < 0) throw new Error(`${label}不能为负数`);
  try {
    assertMaterialQuantity(quantity, quantityScale);
  } catch {
    throw new Error(`${label}必须符合物料计量精度`);
  }
}

/**
 * Stable lock order for every inventory writer:
 * Store -> InventoryBatch -> BatchBalance rows of that batch in id order.
 *
 * Batch balance rows are always locked before they are read, so availability decisions never rely
 * on a pre-lock snapshot. Order reservations and sample reservations are not locked separately:
 * both reservation writers lock the owning batch first.
 */
export async function lockStoreRow(
  tx: Prisma.TransactionClient,
  storeId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
}

export async function lockBatchRow(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "InventoryBatch" WHERE id = ${batchId} FOR UPDATE`;
}

export async function lockBatchBalances(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "BatchBalance"
    WHERE "batchId" = ${batchId}
    ORDER BY id
    FOR UPDATE
  `;
}

export type BatchAvailability = {
  batchOnHand: Prisma.Decimal;
  batchFrozen: Prisma.Decimal;
  orderReserved: Prisma.Decimal;
  sampleReserved: Prisma.Decimal;
  /** On hand minus frozen and active order/sample reservations. May be negative if over-reserved. */
  batchAvailable: Prisma.Decimal;
};

/** Reads batch-level availability after the batch and balance locks are held. */
export async function readBatchAvailability(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<BatchAvailability> {
  const balances = await tx.batchBalance.findMany({
    where: { batchId },
    select: { onHandQty: true, frozenQty: true },
  });
  let batchOnHand = new Prisma.Decimal(0);
  let batchFrozen = new Prisma.Decimal(0);
  for (const balance of balances) {
    batchOnHand = batchOnHand.plus(balance.onHandQty);
    batchFrozen = batchFrozen.plus(balance.frozenQty);
  }

  const [orderReservations, sampleReservations] = await Promise.all([
    tx.inventoryReservation.aggregate({
      where: { batchId, state: ReservationState.ACTIVE },
      _sum: { quantity: true },
    }),
    tx.sampleInventoryReservation.aggregate({
      where: { batchId, state: ReservationState.ACTIVE },
      _sum: { quantity: true },
    }),
  ]);
  const orderReserved = new Prisma.Decimal(orderReservations._sum.quantity ?? 0);
  const sampleReserved = new Prisma.Decimal(sampleReservations._sum.quantity ?? 0);
  return {
    batchOnHand,
    batchFrozen,
    orderReserved,
    sampleReserved,
    batchAvailable: batchOnHand.minus(batchFrozen).minus(orderReserved).minus(sampleReserved),
  };
}

export async function currentLocationAndBatchOnHand(
  tx: Prisma.TransactionClient,
  batchId: string,
  locationId: string,
): Promise<{ locationOnHand: Prisma.Decimal; batchOnHand: Prisma.Decimal }> {
  const balances = await tx.batchBalance.findMany({
    where: { batchId },
    select: { locationId: true, onHandQty: true },
  });
  const target = balances.find((balance) => balance.locationId === locationId);
  let batchOnHand = new Prisma.Decimal(0);
  for (const balance of balances) {
    batchOnHand = batchOnHand.plus(balance.onHandQty);
  }
  return {
    locationOnHand: new Prisma.Decimal(target?.onHandQty ?? 0),
    batchOnHand,
  };
}

function snapshotReason(snapshot: Prisma.JsonValue | null | undefined): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const reason = (snapshot as Record<string, unknown>).reason;
  return typeof reason === "string" ? reason : null;
}

function idempotencyMismatch(): Error {
  return new Error("幂等键已被使用且请求内容不一致，请检查幂等键或换用新的幂等键");
}

/**
 * A concurrent same-key write on a different batch can reach the unique constraint before the
 * other transaction commits. The database rolls the whole transaction back; surface the conflict
 * as the same actionable idempotency error instead of a raw Prisma error.
 */
export function rethrowIdempotencyConflict(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "P2002") {
    throw idempotencyMismatch();
  }
  throw error;
}

async function assertAdjustmentRetryMatches(
  tx: Prisma.TransactionClient,
  existing: {
    id: string;
    kind: string;
    batchId: string;
    quantity: Prisma.Decimal;
    fromLocationId: string | null;
    toLocationId: string | null;
    referenceType: string;
  },
  input: AdjustInventoryInput,
  batchId: string,
  locationId: string,
  reason: string,
): Promise<void> {
  const locationMatches = input.mode === "INCREASE"
    ? existing.toLocationId === locationId && existing.fromLocationId === null
    : existing.fromLocationId === locationId && existing.toLocationId === null;
  if (existing.kind !== TransactionKind.ADJUSTMENT ||
      existing.batchId !== batchId ||
      existing.referenceType !== ADJUSTMENT_REFERENCE_TYPE ||
      !existing.quantity.equals(input.quantity) ||
      !locationMatches) {
    throw idempotencyMismatch();
  }
  const audit = await tx.auditEvent.findFirst({
    where: {
      action: ADJUSTMENT_ACTION,
      entityType: "InventoryTransaction",
      entityId: existing.id,
    },
    orderBy: { occurredAt: "desc" },
  });
  if (!audit || snapshotReason(audit.afterSnapshot) !== reason) {
    throw idempotencyMismatch();
  }
}

/**
 * Adjusts one batch/location balance up or down and records an immutable ADJUSTMENT movement.
 *
 * Lock order Store -> Batch -> sorted balances serializes every writer of this batch. Balance
 * arithmetic is performed with Prisma.Decimal; numbers are only used for input validation and the
 * returned view. A DECREASE can never consume frozen or actively reserved stock and can never make
 * on-hand negative. An exact same-key retry returns the existing movement without a second write.
 */
export async function adjustInventory(
  tx: Prisma.TransactionClient,
  scopeInput: InventoryOperationScope,
  input: AdjustInventoryInput,
): Promise<InventoryAdjustmentResult> {
  const scope = normalizeScope(scopeInput);
  const batchId = text(input.batchId, "库存批次");
  const locationId = text(input.locationId, "库位");
  const reason = text(input.reason, "调整原因");
  const idempotencyKey = text(input.idempotencyKey, "幂等键");
  if (input.mode !== "INCREASE" && input.mode !== "DECREASE") {
    throw new Error("库存调整类型无效");
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

  assertPositiveQuantity(input.quantity, batch.material.quantityScale, "调整数量");

  const existing = await tx.inventoryTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    await assertAdjustmentRetryMatches(tx, existing, input, batchId, locationId, reason);
    const current = await currentLocationAndBatchOnHand(tx, batchId, locationId);
    return {
      transactionId: existing.id,
      batchId,
      locationId,
      mode: input.mode,
      quantity: input.quantity,
      locationOnHand: decimalNumber(current.locationOnHand),
      batchOnHand: decimalNumber(current.batchOnHand),
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

  let nextOnHand: Prisma.Decimal;
  let nextBatchOnHand: Prisma.Decimal;
  if (input.mode === "DECREASE") {
    const locationAvailable = locationOnHand.minus(locationFrozen);
    const available = locationAvailable.lt(availability.batchAvailable)
      ? locationAvailable
      : availability.batchAvailable;
    if (available.lt(input.quantity)) {
      const shown = available.isNegative() ? new Prisma.Decimal(0) : available;
      throw new Error(
        `可用库存不足：当前可用 ${decimalNumber(shown)}${batch.material.baseUnit}，` +
        `本次需要 ${input.quantity}${batch.material.baseUnit}`,
      );
    }
    nextOnHand = locationOnHand.minus(input.quantity);
    if (nextOnHand.isNegative()) {
      throw new Error("调整后库位库存不能为负数");
    }
    nextBatchOnHand = availability.batchOnHand.minus(input.quantity);
  } else {
    nextOnHand = locationOnHand.plus(input.quantity);
    nextBatchOnHand = availability.batchOnHand.plus(input.quantity);
  }

  if (target) {
    await tx.batchBalance.update({
      where: { id: target.id },
      data: { onHandQty: nextOnHand },
    });
  } else {
    await tx.batchBalance.create({
      data: { batchId, locationId, onHandQty: nextOnHand },
    });
  }

  const transaction = await tx.inventoryTransaction.create({
    data: {
      batchId,
      kind: TransactionKind.ADJUSTMENT,
      quantity: input.quantity,
      fromLocationId: input.mode === "DECREASE" ? locationId : null,
      toLocationId: input.mode === "INCREASE" ? locationId : null,
      referenceType: ADJUSTMENT_REFERENCE_TYPE,
      referenceId: batchId,
      idempotencyKey,
    },
  }).catch((error: unknown) => rethrowIdempotencyConflict(error));

  const auditBase = {
    batchId,
    batchNo: batch.batchNo,
    locationId,
    mode: input.mode,
    quantity: input.quantity,
    baseUnit: batch.material.baseUnit,
    reason,
    idempotencyKey,
  };
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: ADJUSTMENT_ACTION,
      entityType: "InventoryTransaction",
      entityId: transaction.id,
      beforeSnapshot: {
        ...auditBase,
        locationOnHand: decimalNumber(locationOnHand),
        batchOnHand: decimalNumber(availability.batchOnHand),
      },
      afterSnapshot: {
        ...auditBase,
        locationOnHand: decimalNumber(nextOnHand),
        batchOnHand: decimalNumber(nextBatchOnHand),
      },
    },
  });

  return {
    transactionId: transaction.id,
    batchId,
    locationId,
    mode: input.mode,
    quantity: input.quantity,
    locationOnHand: decimalNumber(nextOnHand),
    batchOnHand: decimalNumber(nextBatchOnHand),
    idempotent: false,
  };
}

async function assertTransferRetryMatches(
  tx: Prisma.TransactionClient,
  existing: {
    id: string;
    kind: string;
    batchId: string;
    quantity: Prisma.Decimal;
    fromLocationId: string | null;
    toLocationId: string | null;
    referenceType: string;
  },
  input: TransferInventoryInput,
  batchId: string,
  fromLocationId: string,
  toLocationId: string,
  reason: string | null,
): Promise<void> {
  if (existing.kind !== TransactionKind.TRANSFER ||
      existing.batchId !== batchId ||
      existing.referenceType !== TRANSFER_REFERENCE_TYPE ||
      existing.fromLocationId !== fromLocationId ||
      existing.toLocationId !== toLocationId ||
      !existing.quantity.equals(input.quantity)) {
    throw idempotencyMismatch();
  }
  const audit = await tx.auditEvent.findFirst({
    where: {
      action: TRANSFER_ACTION,
      entityType: "InventoryTransaction",
      entityId: existing.id,
    },
    orderBy: { occurredAt: "desc" },
  });
  if (!audit || snapshotReason(audit.afterSnapshot) !== reason) {
    throw idempotencyMismatch();
  }
}

/**
 * Moves quantity between two locations of the same store and batch. The batch total never changes.
 * The source location must have enough unlocked quantity (on hand minus frozen); the target balance
 * is created when it does not exist yet. Same-key retries return the existing movement.
 */
export async function transferInventory(
  tx: Prisma.TransactionClient,
  scopeInput: InventoryOperationScope,
  input: TransferInventoryInput,
): Promise<InventoryTransferResult> {
  const scope = normalizeScope(scopeInput);
  const batchId = text(input.batchId, "库存批次");
  const fromLocationId = text(input.fromLocationId, "转出库位");
  const toLocationId = text(input.toLocationId, "转入库位");
  const idempotencyKey = text(input.idempotencyKey, "幂等键");
  const reason = input.reason?.trim() || null;
  if (fromLocationId === toLocationId) {
    throw new Error("转出库位和转入库位不能相同");
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
  const locations = await tx.inventoryLocation.findMany({
    where: { id: { in: [fromLocationId, toLocationId] } },
  });
  const fromLocation = locations.find((location) => location.id === fromLocationId);
  const toLocation = locations.find((location) => location.id === toLocationId);
  if (!fromLocation || fromLocation.storeId !== scope.storeId) {
    throw new Error("转出库位不存在或不属于当前门店");
  }
  if (!toLocation || toLocation.storeId !== scope.storeId) {
    throw new Error("转入库位不存在或不属于当前门店");
  }
  if (fromLocation.id === toLocation.id) {
    throw new Error("转出库位和转入库位不能相同");
  }

  assertPositiveQuantity(input.quantity, batch.material.quantityScale, "调拨数量");

  const existing = await tx.inventoryTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    await assertTransferRetryMatches(
      tx, existing, input, batchId, fromLocationId, toLocationId, reason,
    );
    const balances = await tx.batchBalance.findMany({
      where: { batchId },
      select: { locationId: true, onHandQty: true },
    });
    const fromBalance = balances.find((balance) => balance.locationId === fromLocationId);
    const toBalance = balances.find((balance) => balance.locationId === toLocationId);
    let batchOnHand = new Prisma.Decimal(0);
    for (const balance of balances) batchOnHand = batchOnHand.plus(balance.onHandQty);
    return {
      transactionId: existing.id,
      batchId,
      fromLocationId,
      toLocationId,
      quantity: input.quantity,
      fromOnHand: decimalNumber(fromBalance?.onHandQty),
      toOnHand: decimalNumber(toBalance?.onHandQty),
      batchOnHand: decimalNumber(batchOnHand),
      idempotent: true,
    };
  }

  const balances = await tx.batchBalance.findMany({
    where: { batchId },
    orderBy: { id: "asc" },
  });
  const fromBalance = balances.find((balance) => balance.locationId === fromLocationId);
  const toBalance = balances.find((balance) => balance.locationId === toLocationId);
  const fromOnHand = new Prisma.Decimal(fromBalance?.onHandQty ?? 0);
  const fromFrozen = new Prisma.Decimal(fromBalance?.frozenQty ?? 0);
  const toOnHand = new Prisma.Decimal(toBalance?.onHandQty ?? 0);
  const sourceAvailable = fromOnHand.minus(fromFrozen);
  if (!fromBalance || sourceAvailable.lt(input.quantity)) {
    const shown = sourceAvailable.isNegative() ? new Prisma.Decimal(0) : sourceAvailable;
    throw new Error(
      `转出库位可用库存不足：当前可用 ${decimalNumber(shown)}${batch.material.baseUnit}，` +
      `本次需要 ${input.quantity}${batch.material.baseUnit}`,
    );
  }

  const nextFromOnHand = fromOnHand.minus(input.quantity);
  if (nextFromOnHand.isNegative()) {
    throw new Error("调拨后转出库位库存不能为负数");
  }
  const nextToOnHand = toOnHand.plus(input.quantity);

  await tx.batchBalance.update({
    where: { id: fromBalance.id },
    data: { onHandQty: nextFromOnHand },
  });
  if (toBalance) {
    await tx.batchBalance.update({
      where: { id: toBalance.id },
      data: { onHandQty: nextToOnHand },
    });
  } else {
    await tx.batchBalance.create({
      data: { batchId, locationId: toLocationId, onHandQty: nextToOnHand },
    });
  }

  const transaction = await tx.inventoryTransaction.create({
    data: {
      batchId,
      kind: TransactionKind.TRANSFER,
      quantity: input.quantity,
      fromLocationId,
      toLocationId,
      referenceType: TRANSFER_REFERENCE_TYPE,
      referenceId: batchId,
      idempotencyKey,
    },
  }).catch((error: unknown) => rethrowIdempotencyConflict(error));

  // Include the source/target post-transfer quantities explicitly so a brand-new target balance
  // (which is absent from the pre-update snapshot) still contributes to the unchanged batch total.
  let batchOnHand = nextFromOnHand.plus(nextToOnHand);
  for (const balance of balances) {
    if (balance.locationId === fromLocationId || balance.locationId === toLocationId) continue;
    batchOnHand = batchOnHand.plus(balance.onHandQty);
  }

  const auditBase = {
    batchId,
    batchNo: batch.batchNo,
    fromLocationId,
    toLocationId,
    quantity: input.quantity,
    baseUnit: batch.material.baseUnit,
    reason,
    idempotencyKey,
  };
  await tx.auditEvent.create({
    data: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      actorStaffId: scope.actorStaffId,
      action: TRANSFER_ACTION,
      entityType: "InventoryTransaction",
      entityId: transaction.id,
      beforeSnapshot: {
        ...auditBase,
        fromOnHand: decimalNumber(fromOnHand),
        toOnHand: decimalNumber(toOnHand),
        batchOnHand: decimalNumber(batchOnHand),
      },
      afterSnapshot: {
        ...auditBase,
        fromOnHand: decimalNumber(nextFromOnHand),
        toOnHand: decimalNumber(nextToOnHand),
        batchOnHand: decimalNumber(batchOnHand),
      },
    },
  });

  return {
    transactionId: transaction.id,
    batchId,
    fromLocationId,
    toLocationId,
    quantity: input.quantity,
    fromOnHand: decimalNumber(nextFromOnHand),
    toOnHand: decimalNumber(nextToOnHand),
    batchOnHand: decimalNumber(batchOnHand),
    idempotent: false,
  };
}

/** Shared deterministic id helper for the stocktake service. */
export function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex")}`;
}
