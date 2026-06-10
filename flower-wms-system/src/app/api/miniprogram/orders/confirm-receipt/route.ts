import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { confirmWechatOrderReceipt } from "@/services/order-lifecycle";

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

/** POST：小程序确认收货 */
export async function POST(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const raw = await request.json();
    const { orderId } = parseBody(raw);
    const order = await confirmWechatOrderReceipt(user.id, orderId);

    return jsonWechatSuccess({
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "确认收货失败";
    const status = message.includes("未登录")
      ? 401
      : message.includes("配送中")
        ? 400
        : 500;
    return jsonError(message, status);
  }
}
