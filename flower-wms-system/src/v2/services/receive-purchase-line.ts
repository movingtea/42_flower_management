import { createHash } from "node:crypto";
import {
  Prisma, PurchaseState, ReceiptDisposition, TransactionKind,
} from "../../generated/prisma-v2/client";
import {
  assertPurchaseCapacity,
  calculatePurchaseProgress,
  nextPurchaseState,
  resolveExpectedBaseQty,
  type PurchaseProgress,
  type PurchaseReceiptRow,
} from "../domain/purchase-progress";
import { assertMaterialQuantity } from "../domain/stock-planning";

export type ReceivePurchaseLineInput = {
  /** Tenant that owns the purchase order, accepted material and audit event. */
  tenantId: string;
  /** Staff member recorded on the receipt audit event. */
  actorStaffId: string;
  purchaseLineId: string;
  locationId: string;
  acceptedMaterialId: string;
  quantity: number;
  batchNo: string;
  usableUntil?: Date;
  disposition: "ACCEPTED" | "DOWNGRADED";
  gradeChangeReason?: string;
  finalUnitCost: number;
  idempotencyKey: string;
};

const EPSILON = 1e-8;

function text(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  return trimmed;
}

function decimal(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function receiptIdFor(operation: string, idempotencyKey: string): string {
  return `gr-${createHash("sha256").update(`${operation}:${idempotencyKey}`).digest("hex")}`;
}

function toRows(
  rows: readonly { disposition: ReceiptDisposition; quantity: Prisma.Decimal | number }[],
): PurchaseReceiptRow[] {
  return rows.map((row) => ({
    disposition: row.disposition,
    quantity: decimal(row.quantity),
  }));
}

function progressSnapshot(progress: PurchaseProgress, purchaseState: string) {
  return {
    purchaseState,
    acceptedOriginalQty: progress.acceptedOriginalQty,
    downgradedQty: progress.downgradedQty,
    rejectedQty: progress.rejectedQty,
    processedQty: progress.processedQty,
    remainingQty: progress.remainingQty,
    hasRejection: progress.hasRejection,
  };
}

/**
 * Recalculates the whole purchase order from every line and every receipt row (all dispositions).
 * A purchase is RECEIVED only when each line has reached its expected base quantity.
 */
async function calculatePurchaseOrderState(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<"RECEIVED" | "PARTIALLY_RECEIVED"> {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId },
    include: { material: true },
    orderBy: { id: "asc" },
  });
  if (lines.length === 0) return "PARTIALLY_RECEIVED";

  const lineIds = lines.map((line) => line.id);
  const receiptRows = await tx.goodsReceiptLine.findMany({
    where: { purchaseLineId: { in: lineIds } },
    select: { purchaseLineId: true, disposition: true, quantity: true },
  });
  const rowsByLine = new Map<string, PurchaseReceiptRow[]>();
  for (const row of receiptRows) {
    if (!row.purchaseLineId) continue;
    const rows = rowsByLine.get(row.purchaseLineId) ?? [];
    rows.push({ disposition: row.disposition, quantity: decimal(row.quantity) });
    rowsByLine.set(row.purchaseLineId, rows);
  }

  for (const line of lines) {
    const expectedBaseQty = resolveExpectedBaseQty(
      line.expectedBaseQty === null ? null : decimal(line.expectedBaseQty),
      decimal(line.orderedQty),
      line.purchaseUnit,
      line.material.baseUnit,
    );
    const progress = calculatePurchaseProgress(
      expectedBaseQty,
      rowsByLine.get(line.id) ?? [],
    );
    if (nextPurchaseState(progress) !== "RECEIVED") return "PARTIALLY_RECEIVED";
  }
  return "RECEIVED";
}

/**
 * One accepted-or-downgraded receipt line, one batch, one balance change and one immutable
 * movement. The caller owns the transaction.
 *
 * Lock order is PurchaseOrder -> all of its PurchaseOrderLine rows in id order. The deterministic
 * receipt id makes a same-key retry return the existing batch without writing or auditing twice.
 */
export async function receivePurchaseLine(
  tx: Prisma.TransactionClient,
  input: ReceivePurchaseLineInput,
): Promise<string> {
  const tenantId = text(input.tenantId, "租户");
  const actorStaffId = text(input.actorStaffId, "操作员工");
  const idempotencyKey = text(input.idempotencyKey, "幂等键");

  // Locate the owning purchase before taking the stable locks.
  const lineRef = await tx.purchaseOrderLine.findUnique({
    where: { id: input.purchaseLineId },
    select: { purchaseOrderId: true },
  });
  if (!lineRef) throw new Error("采购明细不存在或不属于当前门店");

  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${lineRef.purchaseOrderId} FOR UPDATE`;
  await tx.$queryRaw`
    SELECT id FROM "PurchaseOrderLine"
    WHERE "purchaseOrderId" = ${lineRef.purchaseOrderId}
    ORDER BY id
    FOR UPDATE
  `;

  // Re-read only after both locks; ownership and quantities must not rely on the pre-lock read.
  const line = await tx.purchaseOrderLine.findUnique({
    where: { id: input.purchaseLineId },
    include: { purchaseOrder: true, material: true },
  });
  if (!line) throw new Error("采购明细不存在或不属于当前门店");
  const order = line.purchaseOrder;
  if (order.tenantId !== tenantId) {
    throw new Error("采购明细不属于当前租户或门店");
  }

  const location = await tx.inventoryLocation.findUnique({
    where: { id: input.locationId },
  });
  if (!location || location.storeId !== order.storeId) {
    throw new Error("收货库位不属于采购单门店");
  }
  const accepted = await tx.material.findUnique({
    where: { id: input.acceptedMaterialId },
  });
  if (!accepted || accepted.tenantId !== order.tenantId) {
    throw new Error("收货物料不属于采购租户");
  }
  if (accepted.baseUnit !== line.material.baseUnit) {
    throw new Error("收货物料必须与采购明细使用相同基础单位");
  }

  const receiptId = receiptIdFor("receive", idempotencyKey);
  const existing = await tx.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: { lines: true },
  });
  if (existing) {
    if (existing.lines.length !== 1) {
      throw new Error("幂等收货记录与本次请求不一致，请检查幂等键");
    }
    const existingLine = existing.lines[0];
    const quantityMatches =
      Number.isFinite(input.quantity) &&
      Math.abs(decimal(existingLine.quantity) - input.quantity) <= EPSILON;
    if (existingLine.purchaseLineId !== line.id ||
        existingLine.disposition !== input.disposition ||
        !quantityMatches ||
        existingLine.acceptedMaterialId !== input.acceptedMaterialId) {
      throw new Error("幂等收货记录与本次请求不一致，请检查幂等键");
    }
    const batch = await tx.inventoryBatch.findUnique({
      where: { receiptLineId: existingLine.id },
    });
    if (!batch) throw new Error("幂等收货记录缺少库存批次，需人工处理");
    return batch.id;
  }

  if (order.state !== PurchaseState.ORDERED &&
      order.state !== PurchaseState.PARTIALLY_RECEIVED) {
    throw new Error("采购单当前不能验收");
  }

  try {
    assertMaterialQuantity(input.quantity, accepted.quantityScale);
  } catch {
    throw new Error("收货数量必须符合物料计量精度");
  }
  if (!(input.quantity > 0)) throw new Error("收货数量必须大于零");
  if (!Number.isFinite(input.finalUnitCost) || input.finalUnitCost < 0) {
    throw new Error("最终单位成本必须为非负数");
  }
  const batchNo = text(input.batchNo, "批次号");
  if (input.usableUntil &&
      (!Number.isFinite(input.usableUntil.getTime()) ||
       input.usableUntil.getTime() < Date.now())) {
    throw new Error("收货批次有效期必须晚于当前时间");
  }
  if (input.disposition === "DOWNGRADED") {
    if (accepted.id === line.materialId) {
      throw new Error("降级收货必须使用不同的物料规格");
    }
    if (!input.gradeChangeReason?.trim()) {
      throw new Error("降级收货必须填写降级原因");
    }
  } else if (input.disposition === "ACCEPTED") {
    if (accepted.id !== line.materialId) {
      throw new Error("更换物料规格必须选择降级收货");
    }
  } else {
    throw new Error("收货处置类型无效");
  }

  const expectedBaseQty = resolveExpectedBaseQty(
    line.expectedBaseQty === null ? null : decimal(line.expectedBaseQty),
    decimal(line.orderedQty),
    line.purchaseUnit,
    line.material.baseUnit,
  );
  const priorRows = toRows(await tx.goodsReceiptLine.findMany({
    where: { purchaseLineId: line.id },
    select: { disposition: true, quantity: true },
  }));
  const beforeProgress = calculatePurchaseProgress(expectedBaseQty, priorRows);
  const afterProgress = assertPurchaseCapacity(
    expectedBaseQty,
    priorRows,
    input.quantity,
    "验收入库",
    input.disposition,
  );

  const receipt = await tx.goodsReceipt.create({
    data: {
      id: receiptId,
      purchaseOrderId: order.id,
      storeId: order.storeId,
    },
  });
  const receiptLine = await tx.goodsReceiptLine.create({
    data: {
      receiptId: receipt.id,
      purchaseLineId: line.id,
      acceptedMaterialId: accepted.id,
      disposition: input.disposition,
      quantity: input.quantity,
      baseUnit: accepted.baseUnit,
      gradeChangeReason: input.disposition === "DOWNGRADED"
        ? input.gradeChangeReason?.trim()
        : undefined,
      finalUnitCost: input.finalUnitCost,
    },
  });
  const batch = await tx.inventoryBatch.create({
    data: {
      storeId: order.storeId,
      materialId: accepted.id,
      receiptLineId: receiptLine.id,
      batchNo,
      usableUntil: input.usableUntil,
      unitCost: input.finalUnitCost,
      costEstimated: false,
    },
  });
  await tx.batchBalance.create({
    data: {
      batchId: batch.id,
      locationId: location.id,
      onHandQty: input.quantity,
    },
  });
  await tx.inventoryTransaction.create({
    data: {
      batchId: batch.id,
      kind: TransactionKind.INBOUND,
      quantity: input.quantity,
      toLocationId: location.id,
      referenceType: "GOODS_RECEIPT_LINE",
      referenceId: receiptLine.id,
      idempotencyKey,
    },
  });

  const priorPurchaseState = order.state;
  const nextPurchaseStateValue = await calculatePurchaseOrderState(tx, order.id);
  await tx.purchaseOrder.update({
    where: { id: order.id },
    data: { state: nextPurchaseStateValue },
  });

  const auditBase = {
    purchaseOrderNumber: order.number,
    purchaseLineId: line.id,
    disposition: input.disposition,
    quantity: input.quantity,
    expectedBaseQty,
    priorPurchaseState,
    nextPurchaseState: nextPurchaseStateValue,
    idempotencyKey,
  };
  await tx.auditEvent.create({
    data: {
      tenantId: order.tenantId,
      storeId: order.storeId,
      actorStaffId,
      action: "PURCHASE_LINE_RECEIVED",
      entityType: "PurchaseOrderLine",
      entityId: line.id,
      beforeSnapshot: {
        ...auditBase,
        ...progressSnapshot(beforeProgress, priorPurchaseState),
        batchId: null,
        batchNo: null,
      },
      afterSnapshot: {
        ...auditBase,
        ...progressSnapshot(afterProgress, nextPurchaseStateValue),
        batchId: batch.id,
        batchNo,
      },
    },
  });

  return batch.id;
}
