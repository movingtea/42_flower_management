import { StockLogType } from "@/generated/prisma/enums";
import { applyFifoDeductions } from "@/services/fifo";
import { prisma } from "@/lib/prisma";

export type RegisterWastagePayload = {
  batchId: string;
  wastageQty: number;
  reason: string;
  operatorId: string;
};

export type RegisterWastageResult = {
  batch: {
    id: string;
    batchNo: string | null;
    materialId: string;
    remainingQty: number;
  };
  stockLog: {
    id: string;
    type: string;
    delta: number;
    quantity: number;
    wastageReason: string | null;
    operator: string | null;
  };
};

/**
 * 指定批次损耗核销（非跨批次 FIFO）。
 * 业务类型 OUT_WASTE 对应 schema 枚举 StockLogType.WASTAGE_OUT。
 */
export async function registerBatchWastage(
  payload: RegisterWastagePayload
): Promise<RegisterWastageResult> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({
      where: { id: payload.batchId },
      include: { material: { select: { id: true, name: true } } },
    });

    if (!batch) {
      throw new Error("批次不存在");
    }

    if (batch.remainingQty < payload.wastageQty) {
      throw new Error("报损数量不能大于当前批次剩余库存");
    }

    const updated = await tx.batch.updateMany({
      where: {
        id: payload.batchId,
        remainingQty: { gte: payload.wastageQty },
      },
      data: { remainingQty: { decrement: payload.wastageQty } },
    });

    if (updated.count !== 1) {
      throw new Error("报损数量不能大于当前批次剩余库存");
    }

    const stockLog = await tx.stockLog.create({
      data: {
        materialId: batch.materialId,
        batchId: batch.id,
        type: StockLogType.WASTAGE_OUT,
        delta: -payload.wastageQty,
        quantity: payload.wastageQty,
        wastageReason: payload.reason,
        operator: payload.operatorId,
        remark: payload.reason,
      },
    });

    const refreshed = await tx.batch.findUniqueOrThrow({
      where: { id: batch.id },
      select: {
        id: true,
        batchNo: true,
        materialId: true,
        remainingQty: true,
      },
    });

    return {
      batch: refreshed,
      stockLog: {
        id: stockLog.id,
        type: "OUT_WASTE",
        delta: stockLog.delta,
        quantity: stockLog.delta,
        wastageReason: stockLog.wastageReason,
        operator: stockLog.operator,
      },
    };
  });
}

export type MaterialFifoWastagePayload = {
  materialId: string;
  wastageQty: number;
  reason: string;
  operatorId: string;
};

/** 按物料 FIFO 从最早批次扣减损耗 */
export async function registerMaterialFifoWastage(
  payload: MaterialFifoWastagePayload
) {
  if (!Number.isInteger(payload.wastageQty) || payload.wastageQty <= 0) {
    throw new Error("损耗数量须为正整数");
  }

  const material = await prisma.material.findUnique({
    where: { id: payload.materialId },
    select: { id: true, name: true },
  });
  if (!material) throw new Error("物料不存在");

  const deductions = await applyFifoDeductions({
    materialId: payload.materialId,
    quantity: payload.wastageQty,
    logType: StockLogType.WASTAGE_OUT,
    wastageReason: payload.reason,
    operator: payload.operatorId,
  });

  return { material, deductions };
}
