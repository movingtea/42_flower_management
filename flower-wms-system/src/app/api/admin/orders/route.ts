import { jsonError, jsonSuccess } from "@/lib/api";
import { transitionOrderStatus } from "@/services/order-status";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      orderId?: string;
      nextStatus?: string;
      deliveryInfo?: string;
    };

    const orderId = body.orderId?.trim();
    const nextStatus = body.nextStatus?.trim();
    if (!orderId || !nextStatus) {
      return jsonError("orderId 与 nextStatus 不能为空", 400);
    }

    const result = await transitionOrderStatus(orderId, nextStatus, {
      deliveryInfo: body.deliveryInfo,
    });
    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "状态更新失败";
    return jsonError(message, 400);
  }
}
