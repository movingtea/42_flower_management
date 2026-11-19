import { createHash } from "node:crypto";
import {
  Prisma, PurchaseState, ReceiptDisposition,
} from "../../generated/prisma-v2/client";
import {
  assertPurchaseCapacity,
  calculatePurchaseProgress,
  nextPurchaseState,
  resolveExpectedBaseQty,
  type PurchaseProgress,
  type PurchaseProgressState,
  type PurchaseProgressWithExpected,
  type PurchaseReceiptRow,
} from "../domain/purchase-progress";
import { assertMaterialQuantity } from "../domain/stock-planning";

export type RejectPurchaseLineInput = {
  tenantId: string;
  storeId: string;
  purchaseLineId: string;
  quantity: number;
  reason: string;
  actorStaffId: string;
  idempotencyKey: string;
};

export type RejectPurchaseLineResult = {
  receiptId: string;
  purchaseState: PurchaseProgressState;
  progress: PurchaseProgressWithExpected;
};

const EPSILON = 1e-8;
const MAX_REASON_LENGTH = 500;

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

function withExpected(
  progress: PurchaseProgress,
  expectedBaseQty: number,
): PurchaseProgressWithExpected {
  return { ...progress, expectedBaseQty };
}

function snapshot(
  progress: PurchaseProgress,
  expectedBaseQty: number,
  purchaseState: string,
  reason: string,
  idempotencyKey: string,
  purchaseOrderNumber: string,
  purchaseLineId: string,
  quantity: number,
) {
  return {
    purchaseOrderNumber,
    purchaseLineId,
    quantity,
    reason,
    expectedBaseQty,
    purchaseState,
    idempotencyKey,
    acceptedOriginalQty: progress.acceptedOriginalQty,
    downgradedQty: progress.downgradedQty,
    rejectedQty: progress.rejectedQty,
    processedQty: progress.processedQty,
    remainingQty: progress.remainingQty,
    hasRejection: progress.hasRejection,
    progress: withExpected(progress, expectedBaseQty),
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

type LinkedOrderRef = {
  id: string;
  tenantId: string;
  storeId: string;
};

/**
 * Records a rejection against one purchase line. A rejection consumes purchase capacity but never
 * creates stock, so no InventoryBatch, BatchBalance or InventoryTransaction is written.
 *
 * Lock order is PurchaseOrder -> all of its PurchaseOrderLine rows in id order. The deterministic
 * receipt id makes a same-key retry return the existing receipt without writes or duplicate audit.
 */
export async function rejectPurchaseLine(
  tx: Prisma.TransactionClient,
  input: RejectPurchaseLineInput,
): Promise<RejectPurchaseLineResult> {
  const tenantId = text(input.tenantId, "租户");
  const storeId = text(input.storeId, "门店");
  const actorStaffId = text(input.actorStaffId, "操作员工");
  const idempotencyKey = text(input.idempotencyKey, "幂等键");
  const reason = text(input.reason, "拒收原因");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`拒收原因不能超过 ${MAX_REASON_LENGTH} 个字符`);
  }

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

  const line = await tx.purchaseOrderLine.findUnique({
    where: { id: input.purchaseLineId },
    include: { purchaseOrder: true, material: true },
  });
  if (!line ||
      line.purchaseOrder.tenantId !== tenantId ||
      line.purchaseOrder.storeId !== storeId) {
    throw new Error("采购明细不存在或不属于当前门店");
  }

  try {
    assertMaterialQuantity(input.quantity, line.material.quantityScale);
  } catch {
    throw new Error("拒收数量必须符合物料计量精度");
  }
  if (!(input.quantity > 0)) throw new Error("拒收数量必须大于零");

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

  const receiptId = receiptIdFor("reject", idempotencyKey);
  const existing = await tx.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: { lines: true },
  });
  if (existing) {
    if (existing.lines.length !== 1) {
      throw new Error("幂等拒收记录与本次请求不一致，请检查幂等键");
    }
    const existingLine = existing.lines[0];
    const quantityMatches =
      Number.isFinite(input.quantity) &&
      Math.abs(decimal(existingLine.quantity) - input.quantity) <= EPSILON;
    if (existingLine.purchaseLineId !== line.id ||
        existingLine.disposition !== ReceiptDisposition.REJECTED ||
        !quantityMatches ||
        (existingLine.rejectionReason ?? "").trim() !== reason) {
      throw new Error("幂等拒收记录与本次请求不一致，请检查幂等键");
    }
    return {
      receiptId: existing.id,
      purchaseState: await calculatePurchaseOrderState(tx, line.purchaseOrderId),
      progress: withExpected(beforeProgress, expectedBaseQty),
    };
  }

  if (line.purchaseOrder.state !== PurchaseState.ORDERED &&
      line.purchaseOrder.state !== PurchaseState.PARTIALLY_RECEIVED) {
    throw new Error("采购单当前不能验收");
  }

  const afterProgress = assertPurchaseCapacity(
    expectedBaseQty,
    priorRows,
    input.quantity,
    "拒收",
    ReceiptDisposition.REJECTED,
  );

  const receipt = await tx.goodsReceipt.create({
    data: {
      id: receiptId,
      purchaseOrderId: line.purchaseOrderId,
      storeId: line.purchaseOrder.storeId,
    },
  });
  await tx.goodsReceiptLine.create({
    data: {
      receiptId: receipt.id,
      purchaseLineId: line.id,
      disposition: ReceiptDisposition.REJECTED,
      quantity: input.quantity,
      baseUnit: line.material.baseUnit,
      rejectionReason: reason,
    },
  });

  const priorPurchaseState = line.purchaseOrder.state;
  const nextPurchaseStateValue = await calculatePurchaseOrderState(tx, line.purchaseOrderId);
  await tx.purchaseOrder.update({
    where: { id: line.purchaseOrderId },
    data: { state: nextPurchaseStateValue },
  });

  await tx.auditEvent.create({
    data: {
      tenantId: line.purchaseOrder.tenantId,
      storeId: line.purchaseOrder.storeId,
      actorStaffId,
      action: "PURCHASE_LINE_REJECTED",
      entityType: "PurchaseOrderLine",
      entityId: line.id,
      beforeSnapshot: snapshot(
        beforeProgress,
        expectedBaseQty,
        priorPurchaseState,
        reason,
        idempotencyKey,
        line.purchaseOrder.number,
        line.id,
        input.quantity,
      ),
      afterSnapshot: snapshot(
        afterProgress,
        expectedBaseQty,
        nextPurchaseStateValue,
        reason,
        idempotencyKey,
        line.purchaseOrder.number,
        line.id,
        input.quantity,
      ),
    },
  });

  // Rejection adds no stock, so linked orders are not mutated. They still receive a visible audit
  // note so staff know the purchase fallback did not arrive as planned.
  const allocations = await tx.purchaseDemandAllocation.findMany({
    where: { purchaseLineId: line.id },
    select: {
      requirement: {
        select: {
          orderItem: {
            select: {
              order: { select: { id: true, tenantId: true, storeId: true } },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const linkedOrders = new Map<string, LinkedOrderRef>();
  for (const allocation of allocations) {
    const order = allocation.requirement.orderItem.order;
    if (order.tenantId !== line.purchaseOrder.tenantId ||
        order.storeId !== line.purchaseOrder.storeId) {
      throw new Error("关联订单归属与采购单不一致，需人工处理");
    }
    linkedOrders.set(order.id, order);
  }

  for (const order of [...linkedOrders.values()].sort((left, right) =>
    left.id.localeCompare(right.id))) {
    await tx.auditEvent.create({
      data: {
        tenantId: order.tenantId,
        storeId: order.storeId,
        actorStaffId,
        action: "ORDER_PURCHASE_REJECTED",
        entityType: "Order",
        entityId: order.id,
        afterSnapshot: {
          orderId: order.id,
          purchaseOrderNumber: line.purchaseOrder.number,
          purchaseLineId: line.id,
          quantity: input.quantity,
          reason,
          purchaseState: nextPurchaseStateValue,
          remainingQty: afterProgress.remainingQty,
          expectedBaseQty,
          processedQty: afterProgress.processedQty,
          summary: `采购单 ${line.purchaseOrder.number} 拒收 ${input.quantity}${line.material.baseUnit}：${reason}；关联订单仍缺料时请重新采购或人工替换`,
        },
      },
    });
  }

  return {
    receiptId: receipt.id,
    purchaseState: nextPurchaseStateValue,
    progress: withExpected(afterProgress, expectedBaseQty),
  };
}
