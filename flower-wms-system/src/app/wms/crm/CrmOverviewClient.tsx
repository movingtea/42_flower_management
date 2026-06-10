"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CustomerTable } from "@/app/wms/crm/components/CustomerTable";
import { ReminderTable } from "@/app/wms/crm/components/ReminderTable";
import { Section } from "@/app/wms/reports/components/report-ui";
import { StatCard } from "@/components/wms/stat-card";
import { formatCurrency } from "@/lib/format-money";

type SummaryData = {
  metrics: {
    customerCount: number;
    recipientCount: number;
    pendingReminderCount: number;
    weekPendingCount: number;
    todayPendingCount: number;
    highValueCount: number;
    monthNewCustomers: number;
    miniProgramCount: number;
    averageOrderValue: number;
  };
  recentCustomers: Array<{
    id: string;
    name: string;
    phoneMasked?: string | null;
    source: string;
    totalOrders: number;
    totalSpent: number;
    lastOrderAt?: string | null;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    phoneMasked?: string | null;
    source: string;
    totalOrders: number;
    totalSpent: number;
    lastOrderAt?: string | null;
    tags?: string[];
  }>;
  todayReminders: Array<{
    id: string;
    title: string;
    customerId: string;
    customerName?: string | null;
    recipientName?: string | null;
    type: string;
    status: string;
    remindAtLabel?: string | null;
    dueDateLabel?: string | null;
  }>;
  weekReminders: Array<{
    id: string;
    title: string;
    customerId: string;
    customerName?: string | null;
    recipientName?: string | null;
    type: string;
    status: string;
    remindAtLabel?: string | null;
    dueDateLabel?: string | null;
  }>;
};

export function CrmOverviewClient() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/crm/summary");
      const json = (await res.json()) as {
        success: boolean;
        data?: SummaryData;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "CRM 数据加载失败，请稍后重试。");
      }
      setData(json.data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "CRM 数据加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
        正在加载客户 CRM…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
        {error || "CRM 数据加载失败，请稍后重试。"}
      </div>
    );
  }

  const { metrics } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">客户 CRM</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-500">
            从微信小程序订单自动沉淀客户、收花人和礼赠场景，帮助跟进生日、纪念日和复购机会。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/wms/crm/customers"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
          >
            客户列表
          </Link>
          <Link
            href="/wms/crm/reminders"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-700 hover:bg-zinc-50"
          >
            复购提醒
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="客户总数" value={metrics.customerCount} />
        <StatCard label="收花人总数" value={metrics.recipientCount} />
        <StatCard
          label="待跟进提醒"
          value={metrics.pendingReminderCount}
          variant="warning"
        />
        <StatCard
          label="未来 7 天提醒"
          value={metrics.weekPendingCount}
          variant="warning"
        />
        <StatCard
          label="高价值客户"
          value={metrics.highValueCount}
          hint="累计消费 ≥ ¥500 或订单 ≥ 3"
        />
        <StatCard label="本月新增客户" value={metrics.monthNewCustomers} />
        <StatCard label="小程序来源客户" value={metrics.miniProgramCount} />
        <StatCard
          label="平均客单价"
          value={formatCurrency(metrics.averageOrderValue)}
        />
      </div>

      <Section
        title="今日待跟进"
        description="status=PENDING 且提醒时间在今日（Asia/Shanghai）"
      >
        <ReminderTable
          rows={data.todayReminders.map((r) => ({ ...r, status: "PENDING" }))}
          emptyText="今日暂无待跟进提醒。"
          onUpdated={() => void load()}
        />
      </Section>

      <Section title="未来 7 天提醒">
        <ReminderTable
          rows={data.weekReminders.map((r) => ({ ...r, status: "PENDING" }))}
          onUpdated={() => void load()}
        />
      </Section>

      <Section title="最近新增客户">
        <CustomerTable
          rows={data.recentCustomers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phoneMasked,
            source: c.source,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            averageOrderValue:
              c.totalOrders > 0 ? c.totalSpent / c.totalOrders : 0,
            lastOrderAt: c.lastOrderAt,
          }))}
          emptyText="暂无最近新增客户。"
        />
      </Section>

      <Section title="高价值 / 潜在复购客户">
        <CustomerTable
          rows={data.topCustomers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phoneMasked,
            source: c.source,
            totalOrders: c.totalOrders,
            totalSpent: c.totalSpent,
            averageOrderValue:
              c.totalOrders > 0 ? c.totalSpent / c.totalOrders : 0,
            lastOrderAt: c.lastOrderAt,
            tags: c.tags,
          }))}
          emptyText="暂无高价值客户数据。"
        />
      </Section>
    </div>
  );
}
