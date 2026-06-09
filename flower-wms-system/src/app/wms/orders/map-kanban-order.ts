import type { KanbanOrder } from "@/app/wms/orders/types";
import { ORDER_STATUS_LABEL } from "@/services/order-lifecycle";
import type {
  Order,
  OrderCostSnapshot,
  OrderItem,
  OrderStatus,
} from "@/generated/prisma/client";

type OrderWithItems = Order & {
  items: Pick<
    OrderItem,
    "snapshotProductName" | "snapshotSpecName" | "quantity"
  >[];
  costSnapshot: Pick<OrderCostSnapshot, "grossMargin"> | null;
};

export function mapPrismaOrderToKanban(order: OrderWithItems): KanbanOrder {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    statusLabel: ORDER_STATUS_LABEL[order.status as OrderStatus] ?? order.status,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    deliveryAddress: order.deliveryAddress,
    deliveryDate: order.deliveryDate,
    greetingCard: order.greetingCard,
    deliveryInfo: order.deliveryInfo,
    payAmount: order.payAmount.toFixed(2),
    grossMargin: order.costSnapshot?.grossMargin.toFixed(4) ?? null,
    refundAmount: order.refundAmount,
    cancelSource: order.cancelSource ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((line) => ({
      label: `${line.snapshotProductName}（${line.snapshotSpecName}）`,
      quantity: line.quantity,
    })),
  };
}
