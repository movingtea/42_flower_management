"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CustomerSourceBadge,
  GiftOccasionBadge,
  RelationBadge,
  ReminderStatusBadge,
  ReminderTypeBadge,
} from "@/app/wms/crm/components/CrmTagBadge";
import { ReminderActionButtons } from "@/app/wms/crm/components/ReminderActionButtons";
import { Section, TableShell, EmptyRow } from "@/app/wms/reports/components/report-ui";
import { StatCard } from "@/components/wms/stat-card";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format-money";
import { formatDateTime } from "@/lib/format-display";

type DetailData = {
  customer: {
    id: string;
    name?: string | null;
    phoneMasked?: string | null;
    wechatNickname?: string | null;
    source: string;
    note?: string | null;
    tags?: string[];
    totalOrders: number;
    totalSpent: number;
    averageOrderValue: number;
    firstOrderAt?: string | null;
    lastOrderAt?: string | null;
  };
  recipients: Array<{
    relationId: string;
    name: string;
    phoneMasked?: string | null;
    relationType?: string | null;
    relationLabel?: string | null;
    isDefault: boolean;
    preferredColors?: string | null;
    dislikedFlowers?: string | null;
    birthday?: string | null;
    lastUsedAt?: string | null;
  }>;
  occasions: Array<{
    id: string;
    orderId?: string | null;
    occasionType: string;
    occasionLabel?: string | null;
    importantDateLabel?: string | null;
    cardMessage?: string | null;
    createdAt: string;
  }>;
  reminders: Array<{
    id: string;
    title: string;
    content?: string | null;
    type: string;
    status: string;
    remindAtLabel?: string | null;
    dueDateLabel?: string | null;
  }>;
  orders: Array<{
    id: string;
    orderNo: string;
    status: string;
    payAmount: number;
    createdAtLabel?: string | null;
  }>;
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "待支付",
  PAID: "已支付",
  PRODUCTION: "制作中",
  DELIVERING: "配送中",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};

export function CustomerDetailClient({ customerId }: { customerId: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/crm/customers/${customerId}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: DetailData;
        error?: string;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "客户详情加载失败，请稍后重试。");
      }
      setData(json.data);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "客户详情加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500">
        正在加载客户详情…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
        {error || "客户详情加载失败，请稍后重试。"}
      </div>
    );
  }

  const { customer } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/wms/crm/customers" className="text-sm text-emerald-700 hover:underline">
            ← 返回客户列表
          </Link>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-900">
            {customer.name ?? "未命名客户"}
          </h2>
        </div>
        <CustomerSourceBadge source={customer.source} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="累计订单" value={customer.totalOrders} />
        <StatCard label="累计消费" value={formatCurrency(customer.totalSpent)} />
        <StatCard
          label="平均客单价"
          value={formatCurrency(customer.averageOrderValue)}
        />
        <StatCard
          label="最近购买"
          value={formatDateTime(customer.lastOrderAt)}
        />
      </div>

      <Section title="客户基础信息">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">手机号</dt>
            <dd className="mt-1 text-zinc-900">{customer.phoneMasked ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">微信昵称</dt>
            <dd className="mt-1 text-zinc-900">{customer.wechatNickname ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">首次购买</dt>
            <dd className="mt-1 text-zinc-900">
              {formatDateTime(customer.firstOrderAt)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">备注</dt>
            <dd className="mt-1 text-zinc-900">{customer.note ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-zinc-500">标签</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {customer.tags && customer.tags.length > 0
                ? customer.tags.map((tag) => (
                    <Badge key={tag} variant="default">
                      {tag}
                    </Badge>
                  ))
                : "—"}
            </dd>
          </div>
        </dl>
      </Section>

      <Section
        title="常用收花人"
        description="收花人来自小程序下单页或常用收花人保存。删除常用关系不会删除历史订单记录。"
      >
        <TableShell>
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">姓名</th>
              <th className="px-4 py-3">手机号</th>
              <th className="px-4 py-3">关系</th>
              <th className="px-4 py-3">默认</th>
              <th className="px-4 py-3">偏好色系</th>
              <th className="px-4 py-3">忌讳花材</th>
              <th className="px-4 py-3">最近使用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.recipients.length === 0 ? (
              <EmptyRow colSpan={7} text="暂无常用收花人。" />
            ) : (
              data.recipients.map((row) => (
                <tr key={row.relationId}>
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3">{row.phoneMasked ?? "—"}</td>
                  <td className="px-4 py-3">
                    <RelationBadge
                      type={row.relationType}
                      label={row.relationLabel}
                    />
                  </td>
                  <td className="px-4 py-3">{row.isDefault ? "是" : "—"}</td>
                  <td className="px-4 py-3">{row.preferredColors ?? "—"}</td>
                  <td className="px-4 py-3">{row.dislikedFlowers ?? "—"}</td>
                  <td className="px-4 py-3">
                    {formatDateTime(row.lastUsedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="礼赠场景历史">
        <TableShell>
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">场景</th>
              <th className="px-4 py-3">重要日期</th>
              <th className="px-4 py-3">贺卡</th>
              <th className="px-4 py-3">下单时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.occasions.length === 0 ? (
              <EmptyRow colSpan={4} text="暂无礼赠场景记录。" />
            ) : (
              data.occasions.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <GiftOccasionBadge
                      type={row.occasionType}
                      label={row.occasionLabel}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {row.importantDateLabel ?? "—"}
                  </td>
                  <td className="px-4 py-3 max-w-xs truncate">
                    {row.cardMessage ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {formatDateTime(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="复购提醒">
        <TableShell>
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">标题</th>
              <th className="px-4 py-3">类型</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">提醒时间</th>
              <th className="px-4 py-3">目标日期</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.reminders.length === 0 ? (
              <EmptyRow colSpan={6} text="暂无复购提醒。" />
            ) : (
              data.reminders.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.title}</div>
                    {row.content && (
                      <div className="mt-1 text-xs text-zinc-500 line-clamp-2">
                        {row.content}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ReminderTypeBadge type={row.type} />
                  </td>
                  <td className="px-4 py-3">
                    <ReminderStatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">{row.remindAtLabel ?? "—"}</td>
                  <td className="px-4 py-3">{row.dueDateLabel ?? "—"}</td>
                  <td className="px-4 py-3">
                    {row.status === "PENDING" ? (
                      <ReminderActionButtons
                        reminderId={row.id}
                        onUpdated={() => void load()}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableShell>
      </Section>

      <Section title="历史订单">
        {data.orders.length === 0 ? (
          <p className="text-sm text-zinc-500">订单历史将在后续版本完善。</p>
        ) : (
          <TableShell>
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">下单时间</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/wms/orders?orderId=${order.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {order.orderNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {order.createdAtLabel ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </td>
                  <td className="px-4 py-3">
                    {formatCurrency(order.payAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>
    </div>
  );
}
