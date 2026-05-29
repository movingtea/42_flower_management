import { Prisma } from "@/generated/prisma/client";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  applyFifoDeductionsInTx,
  PhysicalStockInsufficientError,
} from "@/services/fifo";
import {
  expandWikiDemandsFromOrderItems,
  PHYSICAL_STOCK_INSUFFICIENT,
} from "@/services/order-fifo-pure";

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
 * 支付成功后：解析配方并按 FIFO 扣减物理批次（须在订单状态更新同一事务内调用）。
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
          spu: {
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
      },
    },
  });

  if (!orderItems.length) {
    throw new Error("订单无明细，无法扣减物理库存");
  }

  const itemLikes = orderItems.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    snapshotProductName: item.snapshotProductName,
    recipeLines:
      item.sku.spu.recipe?.lines.map((line) => ({
        flowerWikiId: line.flowerWikiId,
        quantityNeeded: line.quantityNeeded,
        wiki: line.wiki,
      })) ?? [],
  }));

  const demands = expandWikiDemandsFromOrderItems(itemLikes);
  const results = [];

  for (const demand of demands) {
    const materialId = await resolveMaterialIdForWiki(tx, demand.flowerWikiId);
    const deductions = await applyFifoDeductionsInTx(tx, {
      materialId,
      quantity: demand.quantity,
      logType: StockLogType.SALE_OUT,
      orderId,
      orderItemId: demand.orderItemId,
      operator,
      remark: "销售出库 FIFO",
    });
    results.push({ demand, materialId, deductions });
  }

  return results;
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
        if (order.status === OrderStatus.PAID) return order;
        throw new Error("当前订单状态不可支付");
      }

      await deductPhysicalStockForPaidOrder(tx, orderId, operator);

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );
}
