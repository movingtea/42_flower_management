import { AuditModule } from "@/generated/prisma/enums";
import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { safeLogAuditFromStaff } from "@/lib/audit-helpers";
import { refundPaidOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function parseBody(raw: unknown): { rollbackStock: boolean; refundAmount?: number } {
  if (!raw || typeof raw !== "object") {
    return { rollbackStock: false };
  }
  const b = raw as Record<string, unknown>;
  /** 仅控制虚拟 SKU 可售库存（ProductSku.stock），不涉及物理 Batch */
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
    const staff = await requirePermission("orders:write");
    if (isResponse(staff)) return staff;

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

    safeLogAuditFromStaff(
      staff,
      {
        module: AuditModule.ORDER,
        action: body.rollbackStock ? "ORDER_REFUND_WITH_STOCK" : "ORDER_REFUND",
        entityType: "Order",
        entityId: order.id,
        summary: body.rollbackStock
          ? `订单 ${order.orderNo} 退款取消并回补虚拟 SKU 可售库存`
          : `订单 ${order.orderNo} 退款取消（未回补虚拟 SKU）`,
        afterSnapshot: {
          status: order.status,
          refundAmount: order.refundAmount,
          rollbackStock: body.rollbackStock,
          physicalBatchRestored: false,
        },
      },
      request
    );

    return jsonSuccess({
      message: body.rollbackStock
        ? "订单已退款取消，已回补虚拟 SKU 可售库存；物理花材批次未自动回库，如需回库请在后续显式回库功能中处理"
        : "订单已退款取消；虚拟 SKU 与物理花材批次均未自动回库",
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
