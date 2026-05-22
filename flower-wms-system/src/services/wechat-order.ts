import type { Prisma } from "@/generated/prisma/client";
import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import {
  productBomInclude,
  productCategoriesInclude,
} from "@/lib/product-categories";
import { PRODUCT_STATUS_PUBLISHED } from "@/lib/product-status";
import { prisma } from "@/lib/prisma";

export type WechatOrderItemInput = {
  productId: string;
  quantity: number;
  price: number;
};

export type WechatCreateOrderPayload = {
  wechatOpenId: string;
  totalAmount: number;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryTime?: string;
  items: WechatOrderItemInput[];
};

type BatchDeduction = { batchId: string; materialId: string; take: number };

/** ORD-yyyyMMdd-随机流水 */
export function generateWechatOrderNo(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${date}-${suffix}`;
}

/**
 * 按原材料批次 FIFO 锁库（BOM 展开后的 materialId × 用量）。
 */
async function lockFifoForMaterial(
  tx: Prisma.TransactionClient,
  params: {
    materialId: string;
    materialName: string;
    quantityNeeded: number;
    orderId: string;
    orderItemId: string;
  }
): Promise<BatchDeduction[]> {
  const now = new Date();
  const batches = await tx.batch.findMany({
    where: {
      materialId: params.materialId,
      remainingQty: { gt: 0 },
      OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
    },
    orderBy: { createdAt: "asc" },
  });

  const deductions: BatchDeduction[] = [];
  let remaining = params.quantityNeeded;

  for (const batch of batches) {
    if (remaining <= 0) break;

    const take = Math.min(batch.remainingQty, remaining);
    const updated = await tx.batch.updateMany({
      where: {
        id: batch.id,
        remainingQty: { gte: take },
      },
      data: { remainingQty: { decrement: take } },
    });

    if (updated.count !== 1) {
      throw new Error(
        `原材料「${params.materialName}」库存并发冲突，请重试（批次 ${batch.batchNo ?? batch.id}）`
      );
    }

    await tx.stockLog.create({
      data: {
        materialId: params.materialId,
        batchId: batch.id,
        type: StockLogType.SALE_OUT,
        delta: -take,
        quantity: take,
        orderId: params.orderId,
        orderItemId: params.orderItemId,
        remark: "微信小程序下单锁库（BOM 扣减）",
        operator: "wechat",
      },
    });

    deductions.push({
      batchId: batch.id,
      materialId: params.materialId,
      take,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(
      `原材料「${params.materialName}」库存不足，尚缺 ${remaining}（可能已过期或可售批次不足）`
    );
  }

  return deductions;
}

export async function createWechatOrderWithFifoLock(
  payload: WechatCreateOrderPayload
) {
  const orderNo = generateWechatOrderNo();

  return prisma.$transaction(
    async (tx) => {
      const productIds = [...new Set(payload.items.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          status: PRODUCT_STATUS_PUBLISHED,
          isOutOfStock: false,
        },
        include: {
          ...productCategoriesInclude,
          ...productBomInclude,
        },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      for (const item of payload.items) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new Error(`商品不存在或已下架: ${item.productId}`);
        }
        if (product.quantity < item.quantity) {
          throw new Error(
            `商品「${product.name}」可售数量不足，当前剩余 ${product.quantity} 件`
          );
        }
      }

      const order = await tx.order.create({
        data: {
          orderNo,
          status: OrderStatus.PENDING,
          wechatOpenId: payload.wechatOpenId,
          totalAmount: payload.totalAmount,
          receiverName: payload.receiverName,
          receiverPhone: payload.receiverPhone,
          deliveryAddress: payload.deliveryAddress,
          deliveryTime: payload.deliveryTime
            ? new Date(payload.deliveryTime)
            : undefined,
          remark: "PENDING_PAY",
        },
      });

      const lockSummary: {
        orderItemId: string;
        productId: string;
        deductions: BatchDeduction[];
      }[] = [];

      for (const item of payload.items) {
        const product = productMap.get(item.productId)!;
        const lineTotal = item.price * item.quantity;

        const stockDec = await tx.product.updateMany({
          where: {
            id: item.productId,
            quantity: { gte: item.quantity },
            isOutOfStock: false,
            status: PRODUCT_STATUS_PUBLISHED,
          },
          data: { quantity: { decrement: item.quantity } },
        });

        if (stockDec.count !== 1) {
          throw new Error(`商品「${product.name}」可售数量不足，请刷新后重试`);
        }

        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            productName: product.name,
            productSku: product.sku,
            quantity: item.quantity,
            unitPrice: item.price,
            lineTotal,
          },
        });

        const deductions: BatchDeduction[] = [];

        if (product.bomItems.length > 0) {
          for (const bom of product.bomItems) {
            const need = bom.quantityNeeded * item.quantity;
            const part = await lockFifoForMaterial(tx, {
              materialId: bom.materialId,
              materialName: bom.material.name,
              quantityNeeded: need,
              orderId: order.id,
              orderItemId: orderItem.id,
            });
            deductions.push(...part);
          }
        }

        lockSummary.push({
          orderItemId: orderItem.id,
          productId: item.productId,
          deductions,
        });
      }

      return { order, lockSummary };
    },
    {
      isolationLevel: "Serializable",
      maxWait: 10000,
      timeout: 30000,
    }
  );
}
