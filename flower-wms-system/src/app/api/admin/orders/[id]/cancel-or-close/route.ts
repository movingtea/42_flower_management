import { jsonError, jsonSuccess } from "@/lib/api";
import { closePendingOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    const order = await closePendingOrder(orderId);

    return jsonSuccess({
      message: "订单已关闭，库存已归还",
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        statusLabel: ORDER_STATUS_LABEL[order.status],
        cancelSource: order.cancelSource,
        refundAmount: order.refundAmount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "关闭订单失败";
    return jsonError(message, 400);
  }
}
