import { StatCard } from "@/components/wms/stat-card";
import { Badge } from "@/components/ui/Badge";
import {
  mockDashboardMetrics,
  mockLowStockItems,
  mockRecentOrders,
} from "@/lib/mock/dashboard";

const orderStatusMap: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "info" }
> = {
  pending: { label: "待付款", variant: "warning" },
  paid: { label: "已付款", variant: "info" },
  preparing: { label: "制作中", variant: "default" },
  delivered: { label: "已送达", variant: "success" },
  cancelled: { label: "已取消", variant: "default" },
};

export default function DashboardPage() {
  const m = mockDashboardMetrics;

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">仪表盘</h2>
        <p className="mt-1 text-sm text-zinc-500">
          仪表盘，用于展示仓库的运营情况。
        </p>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="即将过期批次"
          value={m.expiringBatchCount}
          hint="3 即将过期批次"
          variant="danger"
        />
        <StatCard
          label="低库存商品"
          value={m.lowStockProductCount}
          hint="5 低库存商品"
          variant="warning"
        />
        <StatCard
          label="今日损耗率"
          value={m.todayWastageRate}
          hint={`2.3% ${m.todayWastageQty} 今日损耗量`}
          variant="warning"
        />
        <StatCard
          label="今日营收"
          value={`￥${m.todayRevenue}`}
          hint={`${m.todayOrders} 今日订单数`}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900">最近订单</h3>
          <ul className="divide-y divide-zinc-100">
            {mockRecentOrders.map((order) => {
              const status = orderStatusMap[order.status] ?? {
                label: order.status,
                variant: "default" as const,
              };
              return (
                <li
                  key={order.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-medium text-zinc-900">{order.orderNo}</p>
                    <p className="text-sm text-zinc-500">{order.customer}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-rose-600">¥{order.amount}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-amber-900">低库存商品</h3>
          <ul className="space-y-3">
            {mockLowStockItems.map((item) => (
              <li
                key={item.name}
                className="flex items-center justify-between rounded-lg bg-white px-4 py-3"
              >
                <span className="font-medium text-zinc-900">{item.name}</span>
                <span className="text-sm text-amber-700">
                  {item.quantity} 现有库存 / {item.minStock} 安全库存
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
