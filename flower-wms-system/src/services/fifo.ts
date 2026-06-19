import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/tenant-write-context";
import { assertStockMutationAuthorized } from "@/lib/stock-mutation-auth";
import type { FifoDeduction } from "@/types";
import { StockLogType } from "@/generated/prisma/enums";
import { PHYSICAL_STOCK_INSUFFICIENT } from "@/services/order-fifo-pure";

export { PHYSICAL_STOCK_INSUFFICIENT };

type DbClient = Prisma.TransactionClient | typeof prisma;

export class PhysicalStockInsufficientError extends Error {
  constructor(
    message: string,
    readonly flowerWikiId?: string,
    readonly shortfall?: number
  ) {
    super(message);
    this.name = "PhysicalStockInsufficientError";
  }
}

/**
 * 按 createdAt 升序计算 FIFO 扣减计划（不写入数据库）。
 */
export async function calculateFifoDeductions(
  materialId: string,
  quantityNeeded: number,
  client: DbClient = prisma
): Promise<FifoDeduction[]> {
  const batches = await client.batch.findMany({
    where: { materialId, remainingQty: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });

  const deductions: FifoDeduction[] = [];
  let remaining = quantityNeeded;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingQty, remaining);
    deductions.push({
      batchId: batch.id,
      materialId,
      quantity: take,
      inboundAt: batch.inboundAt,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`原材料 ${materialId} 库存不足，尚缺 ${remaining}`);
  }

  return deductions;
}

type ApplyFifoOptions = {
  materialId: string;
  quantity: number;
  logType: typeof StockLogType.SALE_OUT | typeof StockLogType.WASTAGE_OUT;
  operatorStaffId?: string;
  operatorLabel?: string;
  orderId?: string;
  orderItemId?: string;
  wastageReason?: string;
  /** 系统/支付路径操作员快照（无 StaffUser 会话时） */
  operator?: string;
  remark?: string;
};

/**
 * 在既有 Prisma 事务内执行 FIFO 扣减（不开启嵌套 $transaction）。
 * 支付自动化路径可仅传 operator 文本；人工报损应传 operatorStaffId + operatorLabel。
 */
export async function applyFifoDeductionsInTx(
  tx: Prisma.TransactionClient,
  options: ApplyFifoOptions
) {
  let deductions;
  try {
    deductions = await calculateFifoDeductions(
      options.materialId,
      options.quantity,
      tx
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("库存不足")) {
      throw new PhysicalStockInsufficientError(PHYSICAL_STOCK_INSUFFICIENT);
    }
    throw err;
  }

  for (const d of deductions) {
    const updated = await tx.batch.updateMany({
      where: {
        id: d.batchId,
        remainingQty: { gte: d.quantity },
      },
      data: { remainingQty: { decrement: d.quantity } },
    });

    if (updated.count !== 1) {
      throw new PhysicalStockInsufficientError(
        `${PHYSICAL_STOCK_INSUFFICIENT}：批次 ${d.batchId} 并发冲突或余量不足`
      );
    }

    await tx.stockLog.create({
      data: withTenant({
        materialId: options.materialId,
        batchId: d.batchId,
        type: options.logType,
        delta: -d.quantity,
        quantity: d.quantity,
        orderId: options.orderId,
        orderItemId: options.orderItemId,
        wastageReason: options.wastageReason,
        operator: options.operatorLabel ?? options.operator,
        operatorStaffId: options.operatorStaffId,
        remark: options.remark,
      }),
    });
  }

  return deductions;
}

/**
 * 执行 FIFO 扣减：更新批次余量并写入 StockLog（独立事务 + Session 鉴权）。
 */
export async function applyFifoDeductions(options: ApplyFifoOptions) {
  const permission =
    options.logType === StockLogType.SALE_OUT ? "orders:write" : "wms:write";
  const sessionOperator = await assertStockMutationAuthorized(permission);

  if (
    options.operatorStaffId &&
    options.operatorStaffId !== sessionOperator.operatorStaffId
  ) {
    throw new Error("操作员身份与会话不一致，禁止代他人记账");
  }

  const operatorStaffId = sessionOperator.operatorStaffId;
  const operatorLabel = sessionOperator.operatorLabel;

  return prisma.$transaction((tx) =>
    applyFifoDeductionsInTx(tx, {
      ...options,
      operatorStaffId,
      operatorLabel,
    })
  );
}
