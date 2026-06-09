"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/wms/stat-card";
import { formatCurrency, formatPercent, safeDecimalToNumber } from "@/lib/format-money";
import type { BusinessDashboardReport } from "@/services/business-report";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

type BackfillResult = {
  successCount: number;
  failedCount: number;
  failedOrders: Array<{ orderId: string; orderNo: string; error: string }>;
};

const presets = [
  { value: "today", label: "今日" },
  { value: "yesterday", label: "昨日" },
  { value: "thisWeek", label: "本周" },
  { value: "thisMonth", label: "本月" },
  { value: "lastMonth", label: "上月" },
];

const statusLabel: Record<string, string> = {
  PAID: "已支付",
  PRODUCTION: "制作中",
  DELIVERING: "配送中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  PENDING_PAYMENT: "待支付",
};

const alertVariant: Record<string, "default" | "success" | "warning" | "danger"> = {
  OUT_OF_STOCK: "danger",
  LOW: "warning",
  NORMAL: "success",
};

const alertLabel: Record<string, string> = {
  OUT_OF_STOCK: "无库存",
  LOW: "低库存",
  NORMAL: "正常",
};

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ratioWidth(value: string): string {
  const pct = Math.max(0, Math.min(100, safeDecimalToNumber(value) * 100));
  return `${pct}%`;
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-zinc-500">
        {text}
      </td>
    </tr>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
        {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-100">
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}

export function BusinessReportsClient() {
  const [preset, setPreset] = useState("thisMonth");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lowMarginThreshold, setLowMarginThreshold] = useState("0.35");
  const [data, setData] = useState<BusinessDashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate || endDate) {
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
    } else {
      params.set("preset", preset);
    }
    params.set("lowMarginThreshold", lowMarginThreshold || "0.35");
    params.set("limit", "20");
    return params.toString();
  }, [endDate, lowMarginThreshold, preset, startDate]);

  const loadReports = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await fetch(`/api/admin/reports/dashboard?${query}`);
        const json = (await res.json()) as ApiResponse<BusinessDashboardReport>;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "加载经营报表失败");
        }
        setData(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载经营报表失败");
        setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReports();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReports]);

  async function backfillCostSnapshots() {
    setBackfilling(true);
    setBackfillMessage(null);
    try {
      const res = await fetch(`/api/admin/reports/backfill-cost-snapshots?${query}`, {
        method: "POST",
      });
      const json = (await res.json()) as ApiResponse<BackfillResult>;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "补算成本快照失败");
      }
      setBackfillMessage(
        `补算完成：成功 ${json.data.successCount} 个，失败 ${json.data.failedCount} 个。`
      );
      await loadReports(true);
    } catch (err) {
      setBackfillMessage(err instanceof Error ? err.message : "补算成本快照失败");
    } finally {
      setBackfilling(false);
    }
  }

  const defaultCustomRange = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    setStartDate(toDateInputValue(firstDay));
    setEndDate(toDateInputValue(now));
  };

  return (
    <div className="min-w-0">
      <header className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">经营报表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            按日期复盘销售额、真实成本、毛利、花材损耗和库存预警。
          </p>
        </div>
        {data && (
          <p className="text-xs text-zinc-400">
            当前范围：{data.summary.dateRange.label}
          </p>
        )}
      </header>

      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {presets.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setPreset(item.value);
                  setStartDate("");
                  setEndDate("");
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  !startDate && !endDate && preset === item.value
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-zinc-600">
              开始日期
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              结束日期
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              低毛利阈值
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={lowMarginThreshold}
                onChange={(e) => setLowMarginThreshold(e.target.value)}
                className="mt-1 block w-28 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={defaultCustomRange}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              本月自定义
            </button>
            <button
              type="button"
              onClick={() => void loadReports(true)}
              disabled={refreshing || loading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
          正在加载经营报表...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {data.summary.missingSnapshotOrderCount > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p>
                  存在 {data.summary.missingSnapshotOrderCount} 个已支付订单缺少成本快照，
                  可能导致毛利统计偏高。可前往订单详情重新计算成本，或批量补算本范围内缺失快照。
                </p>
                <button
                  type="button"
                  onClick={backfillCostSnapshots}
                  disabled={backfilling}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {backfilling ? "补算中..." : "补算成本快照"}
                </button>
              </div>
              {backfillMessage && <p className="mt-2 text-xs">{backfillMessage}</p>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="销售额"
              value={formatCurrency(data.summary.totalPaidAmount)}
              hint={`有效订单 ${data.summary.paidOrderCount} 笔`}
              variant="success"
            />
            <StatCard
              label="总成本"
              value={formatCurrency(data.summary.totalCost)}
              hint="来自 OrderCostSnapshot 历史快照"
            />
            <StatCard
              label="毛利"
              value={formatCurrency(data.summary.grossProfit)}
              hint={`毛利率 ${formatPercent(data.summary.grossMargin)}`}
              variant={safeDecimalToNumber(data.summary.grossProfit) >= 0 ? "success" : "danger"}
            />
            <StatCard
              label="客单价"
              value={formatCurrency(data.summary.averageOrderValue)}
              hint={`单均毛利 ${formatCurrency(data.summary.averageGrossProfitPerOrder)}`}
            />
            <StatCard
              label="已完成订单"
              value={data.summary.completedOrderCount}
              hint={`取消 ${data.summary.cancelledOrderCount} / 退款 ${data.summary.refundedOrderCount}`}
            />
            <StatCard
              label="花材成本"
              value={formatCurrency(data.summary.flowerMaterialCost)}
              hint={`占总成本 ${formatPercent(data.costStructure.ratios.flowerMaterialCostRatio)}`}
            />
            <StatCard
              label="包装成本"
              value={formatCurrency(data.summary.packagingCost)}
              hint={`占总成本 ${formatPercent(data.costStructure.ratios.packagingCostRatio)}`}
            />
            <StatCard
              label="配送成本"
              value={formatCurrency(data.summary.deliveryCostActual)}
              hint={`占总成本 ${formatPercent(data.costStructure.ratios.deliveryCostRatio)}`}
            />
          </div>

          <Section title="销售趋势" description="按天展示销售额、订单数、成本和毛利率；无订单日期也会显示 0。">
            <TableShell>
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">日期</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">销售额</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">订单数</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">总成本</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.dailySalesTrend.items.length === 0 ? (
                  <EmptyRow colSpan={6} text="暂无销售趋势数据" />
                ) : (
                  data.dailySalesTrend.items.map((item) => (
                    <tr key={item.date} className="hover:bg-zinc-50/50">
                      <td className="px-4 py-3 font-medium text-zinc-900">{item.date}</td>
                      <td className="px-4 py-3">{formatCurrency(item.paidAmount)}</td>
                      <td className="px-4 py-3">{item.orderCount}</td>
                      <td className="px-4 py-3">{formatCurrency(item.totalCost)}</td>
                      <td className="px-4 py-3">{formatCurrency(item.grossProfit)}</td>
                      <td className="px-4 py-3">{formatPercent(item.grossMargin)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableShell>
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="成本结构" description="各成本项占总成本比例，totalCost 为 0 时占比安全显示为 0。">
              <div className="space-y-3">
                {[
                  ["花材成本", data.costStructure.flowerMaterialCost, data.costStructure.ratios.flowerMaterialCostRatio],
                  ["包装成本", data.costStructure.packagingCost, data.costStructure.ratios.packagingCostRatio],
                  ["配送成本", data.costStructure.deliveryCostActual, data.costStructure.ratios.deliveryCostRatio],
                  ["平台费用", data.costStructure.platformFee, data.costStructure.ratios.platformFeeRatio],
                  ["花艺师成本", data.costStructure.floristLaborCost, data.costStructure.ratios.floristLaborCostRatio],
                  ["其他成本", data.costStructure.otherCost, data.costStructure.ratios.otherCostRatio],
                ].map(([label, amount, ratioValue]) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-zinc-700">{label}</span>
                      <span className="text-zinc-500">
                        {formatCurrency(amount)} · {formatPercent(ratioValue)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100">
                      <div
                        className="h-2 rounded-full bg-rose-400"
                        style={{ width: ratioWidth(ratioValue) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="库存预警" description="默认使用每种物料安全库存；未配置时按全局 10 支阈值判断。">
              <TableShell>
                <thead className="border-b border-zinc-100 bg-zinc-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">当前库存</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">库存价值</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">批次数</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">预警</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.inventoryAlerts.items.length === 0 ? (
                    <EmptyRow colSpan={5} text="暂无库存预警数据" />
                  ) : (
                    data.inventoryAlerts.items.slice(0, 12).map((item) => (
                      <tr key={item.flowerWikiId} className="hover:bg-zinc-50/50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-900">{item.flowerName}</p>
                          <p className="text-xs text-zinc-500">{item.reason}</p>
                        </td>
                        <td className="px-4 py-3">{item.remainingQty}</td>
                        <td className="px-4 py-3">{formatCurrency(item.inventoryValue)}</td>
                        <td className="px-4 py-3">{item.activeBatchCount}</td>
                        <td className="px-4 py-3">
                          <Badge variant={alertVariant[item.alertLevel]}>
                            {alertLabel[item.alertLevel]}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableShell>
            </Section>
          </div>

          <Section
            title="产品毛利排行"
            description={`成本归属：${data.productProfitRanking.allocationMethod === "ORDER_AMOUNT_RATIO" ? "按订单项金额比例分摊" : "花材按订单项 SALE_OUT 优先精确归属，其余按金额比例分摊"}`}
          >
            <TableShell>
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">产品名</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">SKU</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">销量</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">销售额</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">总成本</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.productProfitRanking.items.length === 0 ? (
                  <EmptyRow colSpan={7} text="暂无产品毛利数据" />
                ) : (
                  data.productProfitRanking.items.map((item) => (
                    <tr key={`${item.productId}:${item.skuId}`} className="hover:bg-zinc-50/50">
                      <td className="px-4 py-3 font-medium text-zinc-900">{item.productName}</td>
                      <td className="px-4 py-3 text-zinc-600">{item.skuName}</td>
                      <td className="px-4 py-3">{item.orderQuantity}</td>
                      <td className="px-4 py-3">{formatCurrency(item.paidAmount)}</td>
                      <td className="px-4 py-3">{formatCurrency(item.totalCost)}</td>
                      <td className="px-4 py-3">{formatCurrency(item.grossProfit)}</td>
                      <td className="px-4 py-3">{formatPercent(item.grossMargin)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableShell>
          </Section>

          <Section title="低毛利订单" description={`默认筛选毛利率低于 ${formatPercent(data.lowMarginOrders.threshold)} 的有效订单。`}>
            <TableShell>
              <thead className="border-b border-zinc-100 bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">订单号</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">实收金额</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">总成本</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">毛利率</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">下单时间</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.lowMarginOrders.items.length === 0 ? (
                  <EmptyRow colSpan={8} text="暂无低毛利订单" />
                ) : (
                  data.lowMarginOrders.items.map((item) => (
                    <tr key={item.orderId} className="hover:bg-zinc-50/50">
                      <td className="px-4 py-3 font-medium text-zinc-900">{item.orderNo}</td>
                      <td className="px-4 py-3">{formatCurrency(item.paidAmount)}</td>
                      <td className="px-4 py-3">{formatCurrency(item.totalCost)}</td>
                      <td className="px-4 py-3">{formatCurrency(item.grossProfit)}</td>
                      <td className="px-4 py-3 text-amber-700">{formatPercent(item.grossMargin)}</td>
                      <td className="px-4 py-3">{statusLabel[item.status] ?? item.status}</td>
                      <td className="px-4 py-3">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/wms/orders?orderId=${item.orderId}`}
                          className="text-rose-600 hover:underline"
                        >
                          查看订单详情
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableShell>
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="花材使用成本排行" description={data.materialUsage.note}>
              <TableShell>
                <thead className="border-b border-zinc-100 bg-zinc-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">使用数量</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">使用成本</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">平均单价</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">关联订单数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.materialUsage.items.length === 0 ? (
                    <EmptyRow colSpan={5} text="暂无花材使用数据" />
                  ) : (
                    data.materialUsage.items.slice(0, 15).map((item) => (
                      <tr key={item.flowerWikiId} className="hover:bg-zinc-50/50">
                        <td className="px-4 py-3 font-medium text-zinc-900">{item.flowerName}</td>
                        <td className="px-4 py-3">{item.quantityUsed}</td>
                        <td className="px-4 py-3">{formatCurrency(item.totalCost)}</td>
                        <td className="px-4 py-3">{formatCurrency(item.avgUnitCost)}</td>
                        <td className="px-4 py-3">{item.orderCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableShell>
            </Section>

            <Section title="花材损耗排行" description="按报损记录估算损耗金额，优先使用批次 unitCost × 损耗数量。">
              <TableShell>
                <thead className="border-b border-zinc-100 bg-zinc-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-600">花材</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">损耗数量</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">估算损耗金额</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">损耗次数</th>
                    <th className="px-4 py-3 font-medium text-zinc-600">主要原因</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {data.wastage.items.length === 0 ? (
                    <EmptyRow colSpan={5} text="暂无花材损耗数据" />
                  ) : (
                    data.wastage.items.slice(0, 15).map((item) => (
                      <tr key={item.flowerWikiId} className="hover:bg-zinc-50/50">
                        <td className="px-4 py-3 font-medium text-zinc-900">{item.flowerName}</td>
                        <td className="px-4 py-3">{item.lossQuantity}</td>
                        <td className="px-4 py-3">{formatCurrency(item.estimatedLossCost)}</td>
                        <td className="px-4 py-3">{item.lossCount}</td>
                        <td className="px-4 py-3 text-xs text-zinc-600">
                          {item.topReasons.length === 0
                            ? "暂无原因"
                            : item.topReasons
                                .map((reason) => `${reason.reason}（${reason.quantity}）`)
                                .join(" / ")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </TableShell>
            </Section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
