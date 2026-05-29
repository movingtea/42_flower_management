import { jsonError, jsonSuccess } from "@/lib/api";
import { refundPaidOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function parseBody(raw: unknown): { rollbackStock: boolean; refundAmount?: number } {
  if (!raw || typeof raw !== "object") {
    return { rollbackStock: false };
  }
  const b = raw as Record<string, unknown>;
  const rollbackStock = b.rollbackStock === true;
  const refundAmount =
    b.refundAmount != null ? Number(b.refundAmount) : undefined;
  return {
    rollbackStock,
    refundAmount:
      refundAmount != null && Number.isFinite(refundAmount)
        ? refundAmount
        : undefined,
  };
}

export async function POST(request: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    let raw: unknown = {};
    try {
      raw = await request.json();
    } catch {
      /* 空 body */
    }

    const body = parseBody(raw);
    const order = await refundPaidOrder(orderId, body);

    return jsonSuccess({
      message: body.rollbackStock
        ? "已退款取消，物理批次与虚拟库存均已回库"
        : "已退款取消，物理批次已回库（虚拟 SKU 未回滚）",
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        statusLabel: ORDER_STATUS_LABEL[order.status],
        refundAmount: order.refundAmount,
        refundTime: order.refundTime,
        cancelSource: order.cancelSource,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "退款失败";
    return jsonError(message, 400);
  }
}
