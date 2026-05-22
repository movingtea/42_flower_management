import { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { cancelWechatOrderAndReleaseStock } from "@/services/wechat-order-cancel";

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
      msg.includes("仅待付款") ||
      msg.includes("未找到") ||
      msg.includes("不能为空")
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

  return { message: "订单取消失败", status: 500 };
}

export async function POST(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError("无法解析请求体 JSON", 400);
    }

    const { orderId } = parseBody(raw);
    const result = await cancelWechatOrderAndReleaseStock(orderId);

    return jsonWechatSuccess({
      message: "订单已取消，库存已释放",
      order: {
        id: result.order.id,
        orderNo: result.order.orderNo,
        status: "CANCELLED",
        dbStatus: result.order.status,
        updatedAt: result.order.updatedAt,
      },
      released: result.released,
    });
  } catch (err) {
    const { message, status } = mapErrorStatus(err);
    return jsonError(message, status);
  }
}
