import { Prisma } from "@/generated/prisma/client";
import { StockLogType } from "@/generated/prisma/enums";
import type { WmsCategory } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { generateUniqueSku } from "@/utils/skuGenerator";

export type PurchaseInboundPayload = {
  name: string;
  category: WmsCategory;
  safetyStockThreshold: number;
  receivedQty: number;
  costPrice: number;
  expiryDate?: string;
  supplierName?: string;
};

/** B + yyyyMMdd + 3 位流水（当日递增，冲突时顺延） */
async function generateBatchNo(
  tx: Prisma.TransactionClient
): Promise<string> {
  const now = new Date();
  const prefix = `B${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  const existingCount = await tx.batch.count({
    where: { batchNo: { startsWith: prefix } },
  });

  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = String((existingCount + 1 + attempt) % 1000).padStart(3, "0");
    const candidate = `${prefix}${seq}`;
    const clash = await tx.batch.findUnique({
      where: { batchNo: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }

  return `${prefix}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

export async function runPurchaseInboundTransaction(body: PurchaseInboundPayload) {
  return prisma.$transaction(async (tx) => {
    let material = await tx.material.findFirst({
      where: { name: body.name },
    });
    let materialCreated = false;

    if (!material) {
      materialCreated = true;
      const materialCode = await generateUniqueSku("material", tx);
      material = await tx.material.create({
        data: {
          materialCode,
          name: body.name,
          unit: "支",
          safetyStockThreshold: body.safetyStockThreshold,
        },
      });
    } else {
      material = await tx.material.update({
        where: { id: material.id },
        data: { safetyStockThreshold: body.safetyStockThreshold },
      });
    }

    const batchNo = await generateBatchNo(tx);
    const batch = await tx.batch.create({
      data: {
        materialId: material.id,
        batchNo,
        originalQty: body.receivedQty,
        remainingQty: body.receivedQty,
        unitCost: body.costPrice,
        expiresAt: body.expiryDate ? new Date(body.expiryDate) : undefined,
        supplier: body.supplierName,
      },
    });

    const stockLog = await tx.stockLog.create({
      data: {
        materialId: material.id,
        batchId: batch.id,
        type: StockLogType.INBOUND,
        delta: body.receivedQty,
        quantity: body.receivedQty,
        remark: `采购入库（${body.category}）`,
        operator: "system",
      },
    });

    return { materialCreated, material, batch, stockLog };
  });
}
