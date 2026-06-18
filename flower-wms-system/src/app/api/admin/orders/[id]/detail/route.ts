import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getOrderFulfillmentDetail } from "@/services/order-fulfillment-detail";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const staff = await requirePermission("wms:read");
    if (isResponse(staff)) return staff;

    const { id } = await context.params;
    const orderId = id?.trim();
    if (!orderId) return jsonError("订单 ID 无效", 400);

    const detail = await getOrderFulfillmentDetail(orderId);
    return jsonSuccess(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : "加载订单详情失败";
    const status = message.includes("不存在") ? 404 : 500;
    return jsonError(message, status);
  }
}
