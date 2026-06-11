import { Prisma } from "@/generated/prisma/client";
import { AuditModule } from "@/generated/prisma/enums";
import { safeLogAudit } from "@/lib/audit-helpers";
import {
  MINIPROGRAM_ERROR_CODES,
  MiniprogramBusinessError,
  isMiniprogramBusinessError,
} from "@/lib/miniprogram-business-error";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatError, jsonWechatSuccess } from "@/lib/wechat-api";
import { prisma } from "@/lib/prisma";
import { closePendingOrder, ORDER_STATUS_LABEL } from "@/services/order-lifecycle";
import { OrderStatus } from "@/generated/prisma/enums";

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

function mapErrorStatus(err: unknown): {
  message: string;
  status: number;
  code?: string;
} {
  if (isMiniprogramBusinessError(err)) {
    return { message: err.message, status: 400, code: err.code };
  }
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("未登录")) {
      return {
        message: msg,
        status: 401,
        code: MINIPROGRAM_ERROR_CODES.AUTH_REQUIRED,
      };
    }
    if (msg.includes("不存在")) {
      return {
        message: "订单不存在",
        status: 404,
        code: MINIPROGRAM_ERROR_CODES.ORDER_NOT_FOUND,
      };
    }
    if (msg.includes("待支付")) {
      return {
        message: "当前订单状态无法操作",
        status: 400,
        code: MINIPROGRAM_ERROR_CODES.ORDER_INVALID_STATE,
      };
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return {
        message: "订单不存在",
        status: 404,
        code: MINIPROGRAM_ERROR_CODES.ORDER_NOT_FOUND,
      };
    }
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
      return jsonWechatError("无法解析请求体", 400);
    }

    const { orderId } = parseBody(raw);

    const existing = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new MiniprogramBusinessError(
        MINIPROGRAM_ERROR_CODES.ORDER_NOT_FOUND,
        "订单不存在"
      );
    }

    if (existing.status !== OrderStatus.PENDING_PAYMENT) {
      throw new MiniprogramBusinessError(
        MINIPROGRAM_ERROR_CODES.ORDER_INVALID_STATE,
        "当前订单状态无法操作"
      );
    }

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
    const { message, status, code } = mapErrorStatus(err);
    if (code) {
      return jsonWechatError(
        message,
        status,
        code as (typeof MINIPROGRAM_ERROR_CODES)[keyof typeof MINIPROGRAM_ERROR_CODES]
      );
    }
    return jsonWechatError(message, status);
  }
}
