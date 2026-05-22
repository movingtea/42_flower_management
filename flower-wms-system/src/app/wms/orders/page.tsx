import { OrdersKanban } from "./OrdersKanban";
import type { KanbanOrder } from "./types";
import { OrderStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getFulfillmentPhase } from "@/services/order-status";

export const dynamic = "force-dynamic";

const URGENT_MS = 3 * 60 * 60 * 1000;

function sortByDeliveryTime<T extends { deliveryTime: Date | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (!a.deliveryTime && !b.deliveryTime) return 0;
    if (!a.deliveryTime) return 1;
    if (!b.deliveryTime) return -1;
    return a.deliveryTime.getTime() - b.deliveryTime.getTime();
  });
}

function deliveryFlags(deliveryTime: Date | null, now: number) {
  if (!deliveryTime) {
    return { isUrgent: false, isOverdue: false };
  }
  const diff = deliveryTime.getTime() - now;
  return {
    isOverdue: diff < 0,
    isUrgent: diff < URGENT_MS,
  };
}

export default async function WmsOrdersPage() {
  const now = Date.now();

  const rawOrders = await prisma.order.findMany({
    where: {
      status: {
        notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      },
    },
    include: {
      items: {
        include: {
          product: { select: { name: true } },
        },
      },
    },
  });

  const sorted = sortByDeliveryTime(rawOrders);

  let pendingPayCount = 0;
  const kanbanOrders: KanbanOrder[] = [];

  for (const order of sorted) {
    const phase = getFulfillmentPhase(order);
    if (phase === "PENDING_PAY") {
      pendingPayCount += 1;
      continue;
    }
    if (phase === "COMPLETED" || phase === "CANCELLED") {
      continue;
    }

    const { isUrgent, isOverdue } = deliveryFlags(order.deliveryTime, now);

    kanbanOrders.push({
      id: order.id,
      orderNo: order.orderNo,
      phase,
      deliveryTime: order.deliveryTime?.toISOString() ?? null,
      isUrgent,
      isOverdue,
      receiverName: order.receiverName,
      receiverPhone: order.receiverPhone,
      deliveryAddress: order.deliveryAddress,
      totalAmount: order.totalAmount.toString(),
      items: order.items.map((line) => ({
        label: line.productName || line.product.name,
        quantity: line.quantity,
      })),
    });
  }

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-rose-900">
          订单履约看板
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          按预计送达时间排序，加速订单置顶；三栏推进制作与配送。
        </p>
      </header>

      <OrdersKanban orders={kanbanOrders} pendingPayCount={pendingPayCount} />
    </div>
  );
}
