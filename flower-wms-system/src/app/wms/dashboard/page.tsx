import { StatCard } from "@/components/wms/stat-card";
import { Badge } from "@/components/ui/Badge";
import { OrderStatus } from "@/generated/prisma/enums";
import { loadWmsDashboardData } from "@/services/wms-dashboard";

export const dynamic = "force-dynamic";

const orderStatusMap: Record<
  OrderStatus,
  { label: string; variant: "default" | "success" | "warning" | "info" }
> = {
  PENDING: { label: "待付款", variant: "warning" },
  PAID: { label: "已付款", variant: "info" },
  PREPARING: { label: "制作中", variant: "default" },
  DELIVERED: { label: "已送达", variant: "success" },
  CANCELLED: { label: "已取消", variant: "default" },
};

export default async function DashboardPage() {
  const { metrics, recentOrders, lowStockItems } = await loadWmsDashboardData();

  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">仪表盘</h2>
        <p className="mt-1 text-sm text-zinc-500">
          仪表盘，用于展示仓库的运营情况（数据来自 PostgreSQL 实时统计）。
        </p>
      </header>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="即将过期批次"
          value={metrics.expiringBatchCount}
          hint={`${metrics.expiringBatchCount} 个批次将在 3 日内到期`}
          variant="danger"
        />
        <StatCard
          label="低库存原材料"
          value={metrics.lowStockProductCount}
          hint={`${metrics.lowStockProductCount} 种原材料低于安全库存`}
          variant="warning"
        />
        <StatCard
          label="今日损耗率"
          value={metrics.todayWastageRate}
          hint={`今日报损 ${metrics.todayWastageQty} 件（占今日出库量比例）`}
          variant="warning"
        />
        <StatCard
          label="今日营收"
          value={`￥${metrics.todayRevenue}`}
          hint={`今日有效订单 ${metrics.todayOrders} 笔`}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-zinc-900">最近订单</h3>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-zinc-500">暂无订单记录</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {recentOrders.map((order) => {
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
                      <span className="font-medium text-rose-600">
                        ¥{order.amount}
                      </span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-amber-900">
            低库存原材料
          </h3>
          {lowStockItems.length === 0 ? (
            <p className="text-sm text-amber-800/80">当前无低库存预警</p>
          ) : (
            <ul className="space-y-3">
              {lowStockItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-lg bg-white px-4 py-3"
                >
                  <div>
                    <span className="font-medium text-zinc-900">{item.name}</span>
                    <p className="text-xs text-zinc-500">{item.materialCode}</p>
                  </div>
                  <span className="text-sm text-amber-700">
                    {item.quantity} {item.unit} / 安全库存 {item.minStock}{" "}
                    {item.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
