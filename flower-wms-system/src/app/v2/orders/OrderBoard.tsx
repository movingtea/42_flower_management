import { groupOrdersByBoardStage, ORDER_BOARD_COLUMNS } from "../_lib/order-ui";
import type { OrderBoardOrder } from "./order-query";
import { OrderCard } from "./OrderCard";

type Props = {
  orders: OrderBoardOrder[];
  filterQuery: string;
  canManageOrders: boolean;
  canManageProduction: boolean;
  canManageDelivery: boolean;
};

function detailHref(orderId: string, filterQuery: string): string {
  const params = new URLSearchParams(filterQuery);
  params.set("orderId", orderId);
  return `/v2/orders?${params.toString()}`;
}

/** Server-rendered seven-lane board grouped by fulfilment stage. */
export function OrderBoard({
  orders,
  filterQuery,
  canManageOrders,
  canManageProduction,
  canManageDelivery,
}: Props) {
  const grouped = groupOrdersByBoardStage(orders);
  return (
    <section aria-label="订单看板" className="flex gap-3 overflow-x-auto pb-4">
      {ORDER_BOARD_COLUMNS.map((column) => {
        const columnOrders = grouped.find((group) => group.column.id === column.id)?.orders ?? [];
        return (
          <section
            key={column.id}
            className={`flex w-[min(100%,18rem)] shrink-0 flex-col rounded-xl border-2 ${column.accentClass}`}
          >
            <header className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-3">
              <h3 className="text-sm font-semibold text-stone-900">{column.title}</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${column.badgeClass}`}>
                {columnOrders.length}
              </span>
            </header>
            <div className="flex max-h-[calc(100vh-17rem)] min-h-[14rem] flex-1 flex-col gap-2 overflow-y-auto p-2">
              {columnOrders.length === 0
                ? <p className="py-8 text-center text-xs text-stone-400">暂无订单</p>
                : columnOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      stageId={column.id}
                      stageTitle={column.title}
                      detailHref={detailHref(order.id, filterQuery)}
                      canManageOrders={canManageOrders}
                      canManageProduction={canManageProduction}
                      canManageDelivery={canManageDelivery}
                    />
                  ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
