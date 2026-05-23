import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { prisma } from "@/lib/prisma";
import { OrderStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * 微信支付回调占位（个人主体不可用）。
 * 库存在创建订单时已扣减 SKU，此处仅将待支付订单标记为已支付。
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

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return jsonError(`订单状态不可支付: ${order.status}`, 400);
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
      },
    });

    return jsonWechatSuccess({
      orderNo: updated.orderNo,
      status: updated.status,
    });
  } catch {
    return jsonError("回调处理失败", 500);
  }
}
