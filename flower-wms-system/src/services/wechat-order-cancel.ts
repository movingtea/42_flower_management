import { closePendingOrder } from "@/services/order-lifecycle";

/** @deprecated 请使用 closePendingOrder */
export async function cancelWechatOrderAndReleaseStock(
  _userId: string,
  orderId: string
) {
  const order = await closePendingOrder(orderId);
  return { order, released: [] as { batchId: string; quantity: number }[] };
}
