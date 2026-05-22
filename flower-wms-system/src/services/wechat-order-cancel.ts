import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * 取消待付款订单并原路释放锁库库存。
 * 依据下单时 SALE_OUT 流水逐批次退回 remainingQty。
 */
export async function cancelWechatOrderAndReleaseStock(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error("订单不存在");
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new Error("仅待付款（PENDING_PAY）订单可取消或释放库存");
    }

    const lockLogs = await tx.stockLog.findMany({
      where: {
        orderId: order.id,
        type: StockLogType.SALE_OUT,
        delta: { lt: 0 },
      },
    });

    if (lockLogs.length === 0) {
      throw new Error("未找到该订单的锁库流水，无法释放库存");
    }

    const released: { batchId: string; quantity: number }[] = [];

    const orderItems = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: { productId: true, quantity: true },
    });

    for (const line of orderItems) {
      await tx.product.update({
        where: { id: line.productId },
        data: { quantity: { increment: line.quantity } },
      });
    }

    for (const log of lockLogs) {
      const releaseQty = log.quantity;

      await tx.batch.update({
        where: { id: log.batchId },
        data: { remainingQty: { increment: releaseQty } },
      });

      await tx.stockLog.create({
        data: {
          materialId: log.materialId,
          batchId: log.batchId,
          type: StockLogType.IN_CANCEL,
          delta: releaseQty,
          quantity: releaseQty,
          orderId: order.id,
          orderItemId: log.orderItemId,
          remark: "订单取消释放库存",
          operator: "wechat",
        },
      });

      released.push({ batchId: log.batchId, quantity: releaseQty });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        remark: null,
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        updatedAt: true,
      },
    });

    return { order: updated, released };
  });
}
