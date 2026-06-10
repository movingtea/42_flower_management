import { Prisma } from "@/generated/prisma/client";
import { AuditModule } from "@/generated/prisma/enums";
import { jsonError } from "@/lib/api";
import { safeLogAudit } from "@/lib/audit-helpers";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { closePendingOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): { orderId: string } {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" ? b.orderId.trim() : "";

  if (!orderId) {
    throw new Error("orderId 不能为空");
  }

  return { orderId };
}

function mapErrorStatus(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不存在") ||
      msg.includes("待支付") ||
      msg.includes("不能为空") ||
      msg.includes("未登录")
    ) {
      return {
        message: msg,
        status: msg.includes("未登录") ? 401 : 400,
      };
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return { message: "订单不存在", status: 404 };
    }
    return { message: `数据库错误 (${err.code})`, status: 500 };
  }

  if (err instanceof Error) {
    return { message: err.message, status: 500 };
  }

  return { message: "订单取消失败", status: 500 };
}

/** POST：小程序取消待支付订单 */
export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体", 400);
    }

    const { orderId } = parseBody(raw);
    const order = await closePendingOrder(orderId, user.id);

    safeLogAudit({
      actorId: user.id,
      actorName: "小程序用户",
      module: AuditModule.ORDER,
      action: "ORDER_CANCEL",
      entityType: "Order",
      entityId: order.id,
      summary: `用户取消待支付订单 ${order.orderNo}`,
      afterSnapshot: { status: order.status },
    });

    return jsonWechatSuccess({
      message: "订单已取消，库存已归还",
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        statusLabel: ORDER_STATUS_LABEL[order.status],
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
