import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import { loadDashboardData, type DashboardTodo } from "@/v2/services/dashboard";
import { StatusBadge, V2ModulePage, card } from "./_components/V2Ui";
import { readV2Feedback } from "./_lib/search-params";

export const dynamic = "force-dynamic";

const COMMERCIAL_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待确认",
  PENDING_PAYMENT: "待支付",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

const SUPPLY_LABEL: Record<string, string> = {
  NOT_EVALUATED: "未评估",
  ON_HAND_COVERED: "现货覆盖",
  INBOUND_COVERED: "在途覆盖",
  PURCHASE_REQUIRED: "缺料待采购",
  SUBSTITUTION_REQUIRED: "待换料",
  PARTIALLY_COVERED: "部分覆盖",
  UNFULFILLABLE: "无法满足",
};

const PRODUCTION_LABEL: Record<string, string> = {
  NOT_SCHEDULED: "未排产",
  WAITING_MATERIAL: "待物料",
  READY: "待制作",
  IN_PROGRESS: "制作中",
  COMPLETED: "已制作",
  EXCEPTION: "制作异常",
};

const FULFILLMENT_LABEL: Record<string, string> = {
  UNPLANNED: "未安排",
  WAITING_PICKUP: "待自提",
  WAITING_DELIVERY: "待配送",
  DELIVERING: "配送中",
  DELIVERED: "已交付",
  FAILED: "交付失败",
};

const TODO_TONE: Record<DashboardTodo["tone"], string> = {
  danger: "border-red-200 bg-red-50/70 text-red-950",
  warning: "border-amber-200 bg-amber-50/70 text-amber-950",
  info: "border-sky-200 bg-sky-50/70 text-sky-950",
  success: "border-emerald-200 bg-emerald-50/70 text-emerald-950",
};

const TODO_BADGE: Record<DashboardTodo["tone"], "danger" | "warning" | "info" | "success"> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  success: "success",
};

export default async function V2DashboardPage({ searchParams }: PageProps<"/v2">) {
  const session = await auth();
  if (!session?.user || session.user.source !== "v2") {
    redirect("/login?callbackUrl=/v2");
  }
  const context = await requireV2Context("read");
  const [params, dashboard] = await Promise.all([
    searchParams,
    loadDashboardData(v2db, { tenantId: context.tenantId, storeId: context.storeId }),
  ]);
  const feedback = readV2Feedback(params);
  const can = (capability: (typeof context.capabilities)[number]) =>
    context.capabilities.includes(capability);

  const metrics = [
    {
      label: "今日交付营收",
      value: formatCurrency(dashboard.metrics.todayRevenue),
      hint: `今日已交付 ${dashboard.metrics.todayOrderCount} 笔（按成本快照）`,
      href: "/v2/reports?preset=today",
      tone: "success" as const,
    },
    {
      label: "临期批次",
      value: dashboard.metrics.expiringBatchCount,
      hint: "3 日内到期且仍有实存；报表中心按 7 天口径展开",
      href: "/v2/reports?tab=inventory",
      tone: dashboard.metrics.expiringBatchCount > 0 ? ("warning" as const) : ("neutral" as const),
    },
    {
      label: "低库存物料",
      value: dashboard.metrics.lowStockMaterialCount,
      hint: "低于安全库存或零实存，明细见报表中心库存预警",
      href: "/v2/reports?tab=inventory",
      tone: dashboard.metrics.lowStockMaterialCount > 0 ? ("warning" as const) : ("success" as const),
    },
    {
      label: "今日损耗率",
      value: formatPercent(dashboard.metrics.todayLossRate),
      hint: `今日报损 ${dashboard.metrics.todayLossQty}`,
      href: "/v2/reports?tab=loss",
      tone: dashboard.metrics.todayLossRate > 0 ? ("warning" as const) : ("success" as const),
    },
  ];

  return (
    <V2ModulePage
      title="经营概览"
      description="先处理缺料、待采购/验收、待制作和待配送，再查看当日经营与库存风险。所有数字来自 V2 数据库。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          <Link href="/v2/reports" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-white">
            报表中心
          </Link>
          <Link href="/v2/orders" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
            打开订单履约
          </Link>
        </>
      }
    >
      <section aria-labelledby="todo-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="todo-heading" className="text-lg font-semibold text-stone-900">今日待办</h2>
            <p className="mt-1 text-sm text-stone-500">按异常与待推进环节直达对应列表，正常流程不增加人工确认。</p>
          </div>
          <p className="text-xs text-stone-400">生成时间 {formatDateTimeInAppTimezone(dashboard.generatedAt)}</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {dashboard.todos.map((todo) => (
            <Link
              key={todo.key}
              href={todo.href}
              className={`block rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${TODO_TONE[todo.tone]}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{todo.label}</span>
                <StatusBadge tone={todo.count === 0 ? "success" : TODO_BADGE[todo.tone]}>
                  {todo.count === 0 ? "已清" : `${todo.count} 项`}
                </StatusBadge>
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{todo.count}</p>
              <p className="mt-1 text-xs leading-5 opacity-80">{todo.description}</p>
              <span className="mt-2 inline-block text-xs font-medium underline">查看列表 →</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Link key={metric.label} href={metric.href} className="block">
            <div className={`${card} h-full transition hover:border-emerald-300 hover:shadow-md`}>
              <p className="text-xs font-medium text-stone-500">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-stone-900">{metric.value}</p>
              <p className="mt-1 text-xs text-stone-500">{metric.hint}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className={`${card} min-w-0`} aria-labelledby="recent-orders-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="recent-orders-heading" className="text-base font-semibold text-stone-900">最近订单</h2>
            <Link href="/v2/orders" className="text-sm text-emerald-700 hover:underline">全部订单 →</Link>
          </div>
          {dashboard.recentOrders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
              还没有订单。可先完成一笔后台订单验证确认、预留、制作和交付。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50 text-xs text-zinc-600">
                  <tr>
                    <th className="px-3 py-2">订单号</th>
                    <th className="px-3 py-2">商品</th>
                    <th className="px-3 py-2">商业</th>
                    <th className="px-3 py-2">供应</th>
                    <th className="px-3 py-2">制作</th>
                    <th className="px-3 py-2">交付</th>
                    <th className="px-3 py-2">明细</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {dashboard.recentOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-stone-50">
                      <td className="px-3 py-3">
                        <div className="font-medium">{order.number}</div>
                        <div className="text-xs text-stone-500">{formatDateTimeInAppTimezone(order.createdAt)}</div>
                      </td>
                      <td className="max-w-[180px] px-3 py-3 text-xs text-stone-600">{order.itemSummary}</td>
                      <td className="px-3 py-3 text-xs">{COMMERCIAL_LABEL[order.commercialState] ?? order.commercialState}</td>
                      <td className="px-3 py-3 text-xs">
                        <span className={order.supplyState === "PURCHASE_REQUIRED" ? "font-medium text-red-700" : ""}>
                          {SUPPLY_LABEL[order.supplyState] ?? order.supplyState}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">{PRODUCTION_LABEL[order.productionState] ?? order.productionState}</td>
                      <td className="px-3 py-3 text-xs">{FULFILLMENT_LABEL[order.fulfillmentState] ?? order.fulfillmentState}</td>
                      <td className="px-3 py-3">
                        <Link href={`/v2/orders?orderId=${encodeURIComponent(order.id)}`} className="text-emerald-700 hover:underline">
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm" aria-labelledby="low-stock-heading">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="low-stock-heading" className="text-base font-semibold text-amber-950">低库存物料</h2>
            <Link href="/v2/inventory" className="text-xs text-amber-900 underline">库存管理 →</Link>
          </div>
          {dashboard.lowStockItems.length === 0 ? (
            <p className="rounded-lg bg-white px-4 py-6 text-center text-sm text-amber-800">当前没有低库存预警。</p>
          ) : (
            <ul className="space-y-2">
              {dashboard.lowStockItems.map((item) => (
                <li key={item.materialId} className="rounded-lg bg-white px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-stone-900">{item.name}</p>
                      <p className="text-xs text-stone-500">{item.code}</p>
                    </div>
                    <Link href={`/v2/inventory/${item.materialId}`} className="text-xs text-emerald-700 hover:underline">
                      明细
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-amber-800">
                    实存 {item.onHandQty} {item.baseUnit}
                    {item.threshold > 0 ? ` / 安全库存 ${item.threshold}` : " / 零库存"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className={`${card}`} aria-labelledby="operations-links-heading">
        <h2 id="operations-links-heading" className="text-base font-semibold text-stone-900">运营保障入口</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/v2/reports" className="rounded-xl border border-stone-200 px-4 py-3 text-sm hover:border-emerald-300">
            <span className="font-medium text-emerald-800">报表中心</span>
            <span className="mt-1 block text-xs text-stone-500">经营、商品、库存、损耗、采购和成本快照</span>
          </Link>
          <Link href="/v2/setup" className="rounded-xl border border-stone-200 px-4 py-3 text-sm hover:border-emerald-300">
            <span className="font-medium text-emerald-800">试运营检查</span>
            <span className="mt-1 block text-xs text-stone-500">主数据、采购库存订单链路与上线准备</span>
          </Link>
          {can("inventory_review") ? (
            <Link href="/v2/data-quality" className="rounded-xl border border-stone-200 px-4 py-3 text-sm hover:border-emerald-300">
              <span className="font-medium text-emerald-800">数据质量</span>
              <span className="mt-1 block text-xs text-stone-500">缺租户、缺配方、异常库存与非法数量</span>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 text-sm text-stone-500">
              数据质量由管理员、经理或库存复核员查看
            </div>
          )}
          {can("staff") ? (
            <Link href="/v2/system-health" className="rounded-xl border border-stone-200 px-4 py-3 text-sm hover:border-emerald-300">
              <span className="font-medium text-emerald-800">系统健康</span>
              <span className="mt-1 block text-xs text-stone-500">V2 数据库、迁移、环境与磁盘/存储</span>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 text-sm text-stone-500">
              系统健康与操作日志仅管理员可见
            </div>
          )}
        </div>
      </section>
    </V2ModulePage>
  );
}
