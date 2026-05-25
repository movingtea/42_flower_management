import { OrdersKanban } from "./OrdersKanban";
import { mapPrismaOrderToKanban } from "./map-kanban-order";
import { listKanbanOrders } from "@/services/order-lifecycle";
import { loadOrderBomHints } from "@/services/kanban-bom";

export const dynamic = "force-dynamic";

export default async function WmsOrdersPage() {
  const rawOrders = await listKanbanOrders();
  const productionIds = rawOrders
    .filter((o) => o.status === "PRODUCTION")
    .map((o) => o.id);
  const bomHints = await loadOrderBomHints(productionIds);
  const orders = rawOrders.map((o) =>
    mapPrismaOrderToKanban(o, bomHints.get(o.id))
  );

  return (
    <div className="min-w-0">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-rose-900">
          订单履约看板
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Trello 五列瀑布流：支持正向拖拽流转；关闭/退款后自动归入归档列并按语义着色。
        </p>
      </header>

      <OrdersKanban initialOrders={orders} />
    </div>
  );
}
