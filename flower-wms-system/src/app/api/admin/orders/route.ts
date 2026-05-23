import { Prisma } from "@/generated/prisma/client";
import { jsonError, jsonSuccess } from "@/lib/api";
import { transitionOrderStatus } from "@/services/order-status";

export const dynamic = "force-dynamic";

type PatchBody = {
  orderId: string;
  nextStatus: string;
  deliveryInfo?: string;
};

function parsePatchBody(raw: unknown): PatchBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" ? b.orderId.trim() : "";
  const nextStatus =
    typeof b.nextStatus === "string" ? b.nextStatus.trim() : "";

  if (!orderId) throw new Error("orderId 不能为空");
  if (!nextStatus) throw new Error("nextStatus 不能为空");

  const deliveryInfo =
    typeof b.deliveryInfo === "string" ? b.deliveryInfo.trim() : undefined;

  return { orderId, nextStatus, deliveryInfo };
}

function mapErrorStatus(err: unknown): { message: string; status: number } {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("不存在") ||
      msg.includes("不合法") ||
      msg.includes("无效") ||
      msg.includes("不能为空") ||
      msg.includes("不支持")
    ) {
      return { message: msg, status: 400 };
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

  return { message: "订单状态更新失败", status: 500 };
}

export async function PATCH(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 400);
    }

    const body = parsePatchBody(raw);
    const result = await transitionOrderStatus(
      body.orderId,
      body.nextStatus,
      { deliveryInfo: body.deliveryInfo }
    );

    return jsonSuccess({
      message: "订单状态已更新",
      order: {
        id: result.order.id,
        orderNo: result.order.orderNo,
        status: result.status,
        dbStatus: result.dbStatus,
        paidAt: result.order.paidAt,
        updatedAt: result.order.updatedAt,
        refundAmount: result.order.refundAmount,
        cancelSource: result.order.cancelSource,
      },
    });
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
