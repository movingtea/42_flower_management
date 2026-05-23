import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { mockPayWechatOrder } from "@/services/wechat-order";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): { orderId: string } {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const b = raw as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" ? b.orderId.trim() : "";
  if (!orderId) throw new Error("orderId 不能为空");
  return { orderId };
}

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
    const order = await mockPayWechatOrder(user.id, orderId);

    return jsonWechatSuccess({
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      paidAt: order.paidAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "模拟支付失败";
    const status =
      message.includes("未登录") ? 401 : message.includes("不存在") ||
        message.includes("不可支付")
        ? 400
        : 500;
    return jsonError(message, status);
  }
}
