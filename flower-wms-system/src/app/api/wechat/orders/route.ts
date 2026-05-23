import { jsonError } from "@/lib/api";
import { requireUserFromRequest } from "@/lib/wechat-auth-request";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import {
  listWechatOrdersForUser,
  ORDER_STATUS_LABEL,
} from "@/services/order-lifecycle";

export const dynamic = "force-dynamic";

/** GET：当前用户订单列表 */
export async function GET(request: Request) {
  try {
    const user = await requireUserFromRequest(request);
    const orders = await listWechatOrdersForUser(user.id);

    return jsonWechatSuccess({
      orders: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        statusLabel: ORDER_STATUS_LABEL[o.status] ?? o.status,
        totalAmount: o.totalAmount,
        deliveryFee: o.deliveryFee,
        payAmount: o.payAmount,
        receiverName: o.receiverName,
        receiverPhone: o.receiverPhone,
        deliveryAddress: o.deliveryAddress,
        deliveryDate: o.deliveryDate,
        greetingCard: o.greetingCard,
        deliveryInfo: o.deliveryInfo,
        paidAt: o.paidAt,
        createdAt: o.createdAt,
        items: o.items.map((line) => ({
          id: line.id,
          skuId: line.skuId,
          quantity: line.quantity,
          snapshotProductName: line.snapshotProductName,
          snapshotSpecName: line.snapshotSpecName,
          snapshotPrice: line.snapshotPrice,
          snapshotImageUrl: line.snapshotImageUrl,
        })),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取订单失败";
    const status = message.includes("未登录") ? 401 : 500;
    return jsonError(message, status);
  }
}

export async function POST() {
  return jsonError("请使用 POST /api/wechat/orders/create 创建订单", 405);
}
