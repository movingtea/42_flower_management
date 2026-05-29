import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@/generated/prisma/enums";
import {
  markOrderPaidWithFifo,
  PhysicalStockInsufficientError,
  PHYSICAL_STOCK_INSUFFICIENT,
} from "@/services/order-fifo";

export const dynamic = "force-dynamic";

/**
 * 微信支付回调占位（个人主体不可用）。
 * 待支付 → 已支付，同事务按配方 FIFO 扣减物理批次。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      orderNo?: string;
      wechatTransactionId?: string;
    };

    if (!body.orderNo || !body.wechatTransactionId) {
      return jsonError("缺少 orderNo 或 wechatTransactionId", 400);
    }

    const order = await prisma.order.findUnique({
      where: { orderNo: body.orderNo },
    });

    if (!order) {
      return jsonError("订单不存在", 404);
    }

    if (order.status === OrderStatus.PAID) {
      return jsonWechatSuccess({
        orderNo: order.orderNo,
        status: order.status,
      });
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return jsonError(`订单状态不可支付: ${order.status}`, 400);
    }

    const updated = await markOrderPaidWithFifo({
      orderId: order.id,
      operator: "wechat-callback",
    });

    return jsonWechatSuccess({
      orderNo: updated.orderNo,
      status: updated.status,
    });
  } catch (err) {
    if (err instanceof PhysicalStockInsufficientError) {
      return jsonError(err.message, 409);
    }
    if (
      err instanceof Error &&
      (err.message.includes(PHYSICAL_STOCK_INSUFFICIENT) ||
        err.message.includes("未绑定标准配方"))
    ) {
      return jsonError(err.message, 409);
    }
    return jsonError("回调处理失败", 500);
  }
}
