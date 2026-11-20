import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireV2Context } from "@/v2/auth";
import { v2db } from "@/v2/db";
import { formatDateTimeInAppTimezone } from "@/lib/datetime";
import { formatCurrency, formatPercent } from "@/lib/format-money";
import { loadDashboardData, type DashboardTodo } from "@/v2/services/dashboard";
import { V2_ROLE_LABELS } from "@/v2/navigation";
import {
  StatusBadge,
  V2Meta,
  V2ModulePage,
  V2Progress,
  V2Section,
  V2StatCard,
  V2Table,
  button,
  dataTableBody,
  dataTableHead,
  secondaryButton,
} from "./_components/V2Ui";
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

const TODO_TONE: Record<DashboardTodo["tone"], "danger" | "warning" | "info" | "success"> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  success: "success",
};

const TODO_SURFACE: Record<DashboardTodo["tone"], string> = {
  danger: "border-rose-200 bg-rose-50/70 hover:border-rose-300",
  warning: "border-amber-200 bg-amber-50/70 hover:border-amber-300",
  info: "border-sky-200 bg-sky-50/70 hover:border-sky-300",
  success: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300",
};

const TODO_ICON: Record<DashboardTodo["key"], string> = {
  shortage: "🧺",
  purchase: "🧾",
  production: "✂️",
  delivery: "🚚",
  pickup: "🏬",
};

function metricTone(value: number): "success" | "warning" {
  return value > 0 ? "warning" : "success";
}

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
  const canOpenOrders = can("order") || can("production") || can("delivery");
  const canPurchase = can("purchase");
  const canOpenInventory = can("catalog") || can("purchase");

  // The dashboard is readable by every V2 role; only show links the current
  // capability set can actually open. Counts still come from the full dataset.
  const visibleTodos = dashboard.todos.filter((todo) =>
    todo.key === "purchase" ? canPurchase : canOpenOrders
  );
  const totalTodoCount = visibleTodos.reduce((sum, todo) => sum + todo.count, 0);
  const activeTodoCount = visibleTodos.filter((todo) => todo.count > 0).length;
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(dashboard.generatedAt);

  return (
    <V2ModulePage
      title="经营概览"
      description="先处理缺料、待采购/验收、待制作和待配送，再查看当日经营与库存风险。所有数字来自 V2 数据库。"
      message={feedback.message}
      error={feedback.error}
      actions={
        <>
          {canPurchase ? <Link href="/v2/purchase-orders" className={secondaryButton}>采购单</Link> : null}
          {canPurchase
            ? <Link href="/v2/receiving" className={button}>采购收货</Link>
            : <Link href="/v2/reports" className={button}>报表中心</Link>}
        </>
      }
    >
      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-stone-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
              {todayLabel}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
              {activeTodoCount > 0 ? `今天有 ${activeTodoCount} 类事项待推进` : "今天的关键事项已清"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
              {totalTodoCount > 0
                ? `共 ${totalTodoCount} 项待处理，优先处理缺料与到货验收，再安排制作和交付。`
                : "当前没有积压的缺料、采购、制作或交付事项，可继续查看最近订单与库存风险。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canOpenOrders ? <Link href="/v2/orders" className={secondaryButton}>订单履约</Link> : null}
            {canOpenOrders
              ? <Link href="/v2/orders?view=list" className={button}>打开订单列表</Link>
              : canPurchase
                ? <Link href="/v2/receiving" className={button}>采购收货</Link>
                : <Link href="/v2/reports" className={button}>查看报表</Link>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <V2Meta label="最近刷新">{formatDateTimeInAppTimezone(dashboard.generatedAt)}</V2Meta>
          <V2Meta label="角色">
            {context.roles.length > 0
              ? context.roles.map((role) => V2_ROLE_LABELS[role]).join(" / ")
              : "未分配"}
          </V2Meta>
        </div>
      </section>

      <section aria-labelledby="todo-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="todo-heading" className="text-lg font-semibold text-stone-900">今日待办</h2>
            <p className="mt-1 text-sm text-stone-500">按异常与待推进环节直达对应列表，正常流程不增加人工确认。</p>
          </div>
          <p className="text-xs text-stone-400">生成时间 {formatDateTimeInAppTimezone(dashboard.generatedAt)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {visibleTodos.map((todo) => (
            <Link
              key={todo.key}
              href={todo.href}
              className={`group block rounded-2xl border p-4 shadow-sm transition hover:shadow-md ${TODO_SURFACE[todo.tone]}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span aria-hidden className="text-xl">{TODO_ICON[todo.key]}</span>
                <StatusBadge tone={todo.count === 0 ? "success" : TODO_TONE[todo.tone]}>
                  {todo.count === 0 ? "已清" : `${todo.count} 项`}
                </StatusBadge>
              </div>
              <p className="mt-3 text-sm font-semibold text-stone-900">{todo.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-stone-900">{todo.count}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-600">{todo.description}</p>
              <span className="mt-2 inline-block text-xs font-medium text-emerald-800 underline underline-offset-2">
                查看列表 →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <V2StatCard
          label="今日交付营收"
          value={formatCurrency(dashboard.metrics.todayRevenue)}
          hint={`今日已交付 ${dashboard.metrics.todayOrderCount} 笔（按成本快照）`}
          href="/v2/reports?preset=today"
          tone="success"
          icon="💰"
          footer="查看今日经营报表 →"
        />
        <V2StatCard
          label="临期批次"
          value={dashboard.metrics.expiringBatchCount}
          hint="3 日内到期且仍有实存；报表中心按 7 天口径展开"
          href="/v2/reports?tab=inventory"
          tone={metricTone(dashboard.metrics.expiringBatchCount)}
          icon="⏳"
          footer="查看库存预警 →"
        />
        <V2StatCard
          label="低库存物料"
          value={dashboard.metrics.lowStockMaterialCount}
          hint="低于安全库存或零实存，明细见报表中心库存预警"
          href="/v2/reports?tab=inventory"
          tone={metricTone(dashboard.metrics.lowStockMaterialCount)}
          icon="📦"
          footer="查看库存明细 →"
        />
        <V2StatCard
          label="今日损耗率"
          value={formatPercent(dashboard.metrics.todayLossRate)}
          hint={`今日报损 ${dashboard.metrics.todayLossQty}`}
          href="/v2/reports?tab=loss"
          tone={metricTone(dashboard.metrics.todayLossRate)}
          icon="🍂"
          footer="查看损耗报表 →"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <V2Section
          title="最近订单"
          description="按创建时间展示最近 8 笔订单，点击订单号进入履约详情。"
          actions={canOpenOrders
            ? <Link href="/v2/orders" className="text-sm font-medium text-emerald-700 hover:underline">全部订单 →</Link>
            : null}
          className="min-w-0"
        >
          {dashboard.recentOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 px-5 py-10 text-center">
              <p className="text-sm font-medium text-stone-700">还没有订单</p>
              <p className="mt-1 text-sm text-stone-500">可先创建一笔后台订单，验证确认、预留、制作和交付。</p>
              {can("order") ? <Link href="/v2/orders#new-order" className={`${button} mt-4`}>新建订单</Link> : null}
            </div>
          ) : (
            <V2Table label="最近订单" minWidthClass="min-w-[46rem]">
              <thead className={dataTableHead}>
                <tr>
                  <th scope="col" className="px-4 py-3">订单</th>
                  <th scope="col" className="px-4 py-3">商品</th>
                  <th scope="col" className="px-4 py-3">商业</th>
                  <th scope="col" className="px-4 py-3">供应</th>
                  <th scope="col" className="px-4 py-3">制作</th>
                  <th scope="col" className="px-4 py-3">交付</th>
                  <th scope="col" className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className={dataTableBody}>
                {dashboard.recentOrders.map((order) => (
                  <tr key={order.id} className="align-top transition hover:bg-stone-50/70">
                    <td className="px-4 py-3">
                      {canOpenOrders
                        ? <Link href={`/v2/orders?orderId=${encodeURIComponent(order.id)}`} className="font-medium text-stone-900 hover:text-emerald-800">
                            {order.number}
                          </Link>
                        : <span className="font-medium text-stone-900">{order.number}</span>}
                      <div className="mt-0.5 text-xs text-stone-500">{formatDateTimeInAppTimezone(order.createdAt)}</div>
                    </td>
                    <td className="max-w-[15rem] px-4 py-3 text-xs leading-5 text-stone-600">{order.itemSummary}</td>
                    <td className="px-4 py-3 text-xs">{COMMERCIAL_LABEL[order.commercialState] ?? order.commercialState}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={order.supplyState === "PURCHASE_REQUIRED" ? "font-medium text-rose-700" : ""}>
                        {SUPPLY_LABEL[order.supplyState] ?? order.supplyState}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{PRODUCTION_LABEL[order.productionState] ?? order.productionState}</td>
                    <td className="px-4 py-3 text-xs">{FULFILLMENT_LABEL[order.fulfillmentState] ?? order.fulfillmentState}</td>
                    <td className="px-4 py-3">
                      {canOpenOrders
                        ? <Link href={`/v2/orders?orderId=${encodeURIComponent(order.id)}`} className="text-xs font-medium text-emerald-700 hover:underline">
                            查看
                          </Link>
                        : <span className="text-xs text-stone-400">只读</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </V2Table>
          )}
        </V2Section>

        <V2Section
          title="低库存物料"
          description="展示低于安全库存最严重的 6 项，完整明细在库存管理与报表中心。"
          actions={canOpenInventory
            ? <Link href="/v2/inventory" className="text-xs font-medium text-emerald-700 hover:underline">库存管理 →</Link>
            : null}
          className="border-amber-200"
        >
          {dashboard.lowStockItems.length === 0 ? (
            <p className="rounded-xl bg-white px-4 py-8 text-center text-sm text-emerald-800">当前没有低库存预警。</p>
          ) : (
            <ul className="space-y-2">
              {dashboard.lowStockItems.map((item) => {
                const max = Math.max(item.threshold, item.onHandQty, 1);
                const tone = item.onHandQty <= 0 ? "danger" : item.threshold > 0 && item.onHandQty < item.threshold ? "warning" : "success";
                return (
                  <li key={item.materialId} className="rounded-xl border border-amber-100 bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-900">{item.name}</p>
                        <p className="font-mono text-[11px] text-stone-500">{item.code}</p>
                      </div>
                      {canOpenInventory
                        ? <Link href={`/v2/inventory/${item.materialId}`} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">
                            明细
                          </Link>
                        : null}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-amber-900">
                      <span>实存 {item.onHandQty} {item.baseUnit}</span>
                      <span>{item.threshold > 0 ? `安全库存 ${item.threshold}` : "零库存预警"}</span>
                    </div>
                    <div className="mt-1.5">
                      <V2Progress
                        value={item.onHandQty}
                        max={max}
                        tone={tone}
                        label={`${item.name} 库存覆盖情况`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </V2Section>
      </div>

      <V2Section
        title="运营保障入口"
        description="按当前账号能力展示可用入口；无权限的模块不会渲染可点击入口。"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/v2/reports" className="rounded-xl border border-stone-200 px-4 py-3 text-sm transition hover:border-emerald-300 hover:bg-emerald-50/40">
            <span className="font-medium text-emerald-800">报表中心</span>
            <span className="mt-1 block text-xs text-stone-500">经营、商品、库存、损耗、采购和成本快照</span>
          </Link>
          {canPurchase ? (
            <Link href="/v2/receiving" className="rounded-xl border border-stone-200 px-4 py-3 text-sm transition hover:border-emerald-300 hover:bg-emerald-50/40">
              <span className="font-medium text-emerald-800">采购收货</span>
              <span className="mt-1 block text-xs text-stone-500">按采购明细验收、降级或拒收，追踪剩余数量</span>
            </Link>
          ) : null}
          <Link href="/v2/setup" className="rounded-xl border border-stone-200 px-4 py-3 text-sm transition hover:border-emerald-300 hover:bg-emerald-50/40">
            <span className="font-medium text-emerald-800">试运营检查</span>
            <span className="mt-1 block text-xs text-stone-500">主数据、采购库存订单链路与上线准备</span>
          </Link>
          {can("inventory_review") ? (
            <Link href="/v2/data-quality" className="rounded-xl border border-stone-200 px-4 py-3 text-sm transition hover:border-emerald-300 hover:bg-emerald-50/40">
              <span className="font-medium text-emerald-800">数据质量</span>
              <span className="mt-1 block text-xs text-stone-500">缺租户、缺配方、异常库存与非法数量</span>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 text-sm text-stone-500">
              数据质量由管理员、经理或库存复核员查看
            </div>
          )}
          {can("staff") ? (
            <Link href="/v2/system-health" className="rounded-xl border border-stone-200 px-4 py-3 text-sm transition hover:border-emerald-300 hover:bg-emerald-50/40">
              <span className="font-medium text-emerald-800">系统健康</span>
              <span className="mt-1 block text-xs text-stone-500">V2 数据库、迁移、环境与磁盘/存储</span>
            </Link>
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 text-sm text-stone-500">
              系统健康与操作日志仅管理员可见
            </div>
          )}
        </div>
      </V2Section>
    </V2ModulePage>
  );
}
