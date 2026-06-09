import { Prisma } from "@/generated/prisma/client";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  applyFifoDeductionsInTx,
  PhysicalStockInsufficientError,
} from "@/services/fifo";
import {
  expandAndAggregateWikiDemands,
  PHYSICAL_STOCK_INSUFFICIENT,
} from "@/services/order-fifo-pure";
import { upsertOrderCostSnapshot } from "@/services/order-cost";

export { PhysicalStockInsufficientError, PHYSICAL_STOCK_INSUFFICIENT };

/** flower_wiki_id → materials.id（须在事务内调用） */
async function resolveMaterialIdForWiki(
  tx: PrismaTypes.TransactionClient,
  flowerWikiId: string
): Promise<string> {
  const material = await tx.material.findFirst({
    where: { wikiId: flowerWikiId },
    select: { id: true },
  });

  if (!material) {
    throw new PhysicalStockInsufficientError(
      `${PHYSICAL_STOCK_INSUFFICIENT}：花材「${flowerWikiId}」尚无物理入库批次`,
      flowerWikiId
    );
  }

  return material.id;
}

/**
 * 支付成功后：按 SKU.recipeId 展开配方 → 按 wiki 汇总 → FIFO 扣减物理批次。
 * 须在订单状态更新同一 Serializable 事务内调用。
 */
export async function deductPhysicalStockForPaidOrder(
  tx: PrismaTypes.TransactionClient,
  orderId: string,
  operator = "order-payment"
) {
  const orderItems = await tx.orderItem.findMany({
    where: { orderId },
    include: {
      sku: {
        include: {
          recipe: {
            include: {
              lines: {
                include: {
                  wiki: { select: { chineseName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!orderItems.length) {
    throw new Error("订单无明细，无法扣减物理库存");
  }

  const skuInputs = orderItems.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    snapshotProductName: `${item.snapshotProductName}（${item.snapshotSpecName}）`,
    recipeId: item.sku.recipeId,
    recipeLines:
      item.sku.recipe?.lines.map((line) => ({
        flowerWikiId: line.flowerWikiId,
        quantityNeeded: line.quantityNeeded,
        wiki: line.wiki,
      })) ?? [],
  }));

  const aggregatedDemands = expandAndAggregateWikiDemands(skuInputs);
  const results = [];

  for (const demand of aggregatedDemands) {
    const materialId = await resolveMaterialIdForWiki(tx, demand.flowerWikiId);
    // 已在父级 Serializable 事务内：使用 applyFifoDeductionsInTx（非嵌套 $transaction 的 applyFifoDeductions）
    const deductions = await applyFifoDeductionsInTx(tx, {
      materialId,
      quantity: demand.quantity,
      logType: StockLogType.SALE_OUT,
      orderId,
      operator,
      remark: "销售出库 FIFO",
    });
    results.push({ demand, materialId, deductions });
  }

  return results;
}

export const IN_CANCEL_REFUND_OPERATOR = "SYSTEM_REFUND_AUTO";

/**
 * 按支付时 SALE_OUT 流水原路补偿物理批次，并写入 IN_CANCEL 留痕。
 * 须在父级 Serializable 事务内调用。
 */
export async function restorePhysicalStockFromSaleOutInTx(
  tx: PrismaTypes.TransactionClient,
  orderId: string,
  operator: string = IN_CANCEL_REFUND_OPERATOR
): Promise<number> {
  const alreadyReversed = await tx.stockLog.count({
    where: { orderId, type: StockLogType.IN_CANCEL },
  });
  if (alreadyReversed > 0) {
    throw new Error("该订单物理库存已回库，不可重复操作");
  }

  const saleOutLogs = await tx.stockLog.findMany({
    where: {
      orderId,
      type: StockLogType.SALE_OUT,
    },
    orderBy: { createdAt: "asc" },
  });

  for (const log of saleOutLogs) {
    const batch = await tx.batch.findUnique({
      where: { id: log.batchId },
      select: { id: true },
    });

    if (!batch) {
      throw new Error(
        `物理批次 ${log.batchId} 不存在，订单 ${orderId} 无法原路回库`
      );
    }

    await tx.batch.update({
      where: { id: log.batchId },
      data: { remainingQty: { increment: log.quantity } },
    });

    await tx.stockLog.create({
      data: {
        materialId: log.materialId,
        batchId: log.batchId,
        type: StockLogType.IN_CANCEL,
        delta: log.quantity,
        quantity: log.quantity,
        orderId,
        orderItemId: log.orderItemId,
        operator,
      },
    });
  }

  return saleOutLogs.length;
}

type MarkPaidOptions = {
  orderId: string;
  /** 微信 mock 支付时传入，约束订单归属 */
  userId?: string;
  operator?: string;
};

/**
 * 原子：待支付 → 已支付 + FIFO 物理扣减。
 */
export async function markOrderPaidWithFifo(options: MarkPaidOptions) {
  const { orderId, userId, operator } = options;

  return prisma.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.PENDING_PAYMENT,
          ...(userId ? { userId } : {}),
        },
        data: {
          status: OrderStatus.PAID,
          paidAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        const order = await tx.order.findFirst({
          where: { id: orderId, ...(userId ? { userId } : {}) },
        });
        if (!order) throw new Error("订单不存在");
        if (order.status === OrderStatus.PAID) {
          await upsertOrderCostSnapshot(orderId, tx);
          return tx.order.findUniqueOrThrow({ where: { id: orderId } });
        }
        throw new Error("当前订单状态不可支付");
      }

      await deductPhysicalStockForPaidOrder(tx, orderId, operator);
      await upsertOrderCostSnapshot(orderId, tx);

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}
