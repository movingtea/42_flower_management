import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant/tenant-write-context";
import { StockLogType } from "@/generated/prisma/enums";
import type { StocktakeInput } from "@/types";

export async function adjustStockByStocktake(input: StocktakeInput) {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: input.batchId },
  });

  const delta = input.newRemainingQty - batch.remainingQty;
  if (delta === 0) {
    return { batch, delta: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.batch.update({
      where: { id: input.batchId },
      data: { remainingQty: input.newRemainingQty },
    });

    await tx.stockLog.create({
      data: withTenant({
        materialId: batch.materialId,
        batchId: batch.id,
        type: StockLogType.ADJUSTMENT,
        delta,
        quantity: Math.abs(delta),
        remark: input.remark,
        operator: input.operator,
      }),
    });

    return { batch: updated, delta };
  });
}
