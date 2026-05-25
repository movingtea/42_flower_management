import { OrderStatus } from "@/generated/prisma/enums";
import {
  adminMarkOrderPaid,
  adminTransitionOrder,
  ORDER_STATUS_LABEL,
  type AdminTransition,
} from "@/services/order-lifecycle";
import { triggerOrderProductionDeduction } from "@/services/order-bom-deduct";
export { ORDER_STATUS_LABEL };

export type FulfillmentPhase = OrderStatus;

export function parseAdminTransition(
  raw: string
): AdminTransition | "PAID" | null {
  const key = raw.trim().toUpperCase();
  if (key === "PAID") return "PAID";
  if (key === "PRODUCTION" || key === "MAKING" || key === "PREPARING") {
    return "PRODUCTION";
  }
  if (key === "DELIVERING") return "DELIVERING";
  if (key === "COMPLETED" || key === "DELIVERED") return "COMPLETED";
  return null;
}

export async function transitionOrderStatus(
  orderId: string,
  nextStatusInput: string,
  extra?: { deliveryInfo?: string }
) {
  const next = parseAdminTransition(nextStatusInput);
  if (!next) {
    throw new Error(
      `无效的目标状态：${nextStatusInput}。允许：PAID、PRODUCTION、DELIVERING、COMPLETED`
    );
  }

  const order =
    next === "PAID"
      ? await adminMarkOrderPaid(orderId)
      : await adminTransitionOrder(orderId, next, extra);

  if (next === "PRODUCTION" && order.status === OrderStatus.PRODUCTION) {
    triggerOrderProductionDeduction(orderId);
  }

  return {
    order: {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      paidAt: order.paidAt,
      updatedAt: order.updatedAt,
      refundAmount: order.refundAmount,
      cancelSource: order.cancelSource,
    },
    status: order.status,
    dbStatus: order.status,
    statusLabel: ORDER_STATUS_LABEL[order.status],
  };
}
