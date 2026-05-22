import { prisma } from "@/lib/prisma";
import type { FifoDeduction } from "@/types";
import { StockLogType } from "@/generated/prisma/enums";

/**
 * 按 inboundAt 升序计算 FIFO 扣减计划（不写入数据库）。
 */
export async function calculateFifoDeductions(
  materialId: string,
  quantityNeeded: number
): Promise<FifoDeduction[]> {
  const batches = await prisma.batch.findMany({
    where: { materialId, remainingQty: { gt: 0 } },
    orderBy: { inboundAt: "asc" },
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
  orderId?: string;
  orderItemId?: string;
  wastageReason?: string;
  operator?: string;
};

/**
 * 执行 FIFO 扣减：更新批次余量并写入 StockLog。
 */
export async function applyFifoDeductions(options: ApplyFifoOptions) {
  const deductions = await calculateFifoDeductions(
    options.materialId,
    options.quantity
  );

  return prisma.$transaction(async (tx) => {
    for (const d of deductions) {
      await tx.batch.update({
        where: { id: d.batchId },
        data: { remainingQty: { decrement: d.quantity } },
      });
      await tx.stockLog.create({
        data: {
          materialId: options.materialId,
          batchId: d.batchId,
          type: options.logType,
          delta: -d.quantity,
          quantity: d.quantity,
          orderId: options.orderId,
          orderItemId: options.orderItemId,
          wastageReason: options.wastageReason,
          operator: options.operator,
        },
      });
    }
    return deductions;
  });
}
