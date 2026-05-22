import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { prisma } from "@/lib/prisma";
import type { WechatPayCallbackInput } from "@/types";
import { OrderStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * POST：微信支付成功回调。
 * 库存在下单 POST /api/wechat/orders 时已 FIFO 锁定，此处仅更新订单为已付款。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WechatPayCallbackInput;

    if (!body.orderNo || !body.wechatTransactionId) {
      return jsonError("缺少 orderNo 或 wechatTransactionId", 400);
    }

    const order = await prisma.order.findUnique({
      where: { orderNo: body.orderNo },
    });

    if (!order) {
      return jsonError("订单不存在", 404);
    }

    if (order.status !== OrderStatus.PENDING) {
      return jsonError(`订单状态不可支付: ${order.status}`, 400);
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        wechatTransactionId: body.wechatTransactionId,
        paidAt: new Date(),
      },
    });

    return jsonWechatSuccess({
      orderNo: updated.orderNo,
      status: OrderStatus.PAID,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "支付回调处理失败";
    return jsonError(message, 500);
  }
}
