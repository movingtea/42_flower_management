import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { closePendingOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  try {
    const staff = await requirePermission("orders:write");
    if (isResponse(staff)) return staff;

    const { id } = await ctx.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    const order = await closePendingOrder(orderId);

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.ORDER,
        action: "ORDER_CANCEL_OR_CLOSE",
        entityType: "Order",
        entityId: order.id,
        summary: `关闭待支付订单 ${order.orderNo}`,
        afterSnapshot: {
          status: order.status,
          cancelSource: order.cancelSource,
        },
      },
      request
    );

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
