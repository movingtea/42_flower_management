"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import { CustomerSourceBadge } from "@/app/wms/crm/components/CrmTagBadge";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
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
  recipients: Array<{ name: string; relationLabel?: string | null }>;
  reminders: Array<{ id: string; title: string; status: string }>;
};

type Props = {
  customerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomerDetailDrawer({
  customerId,
  open,
  onOpenChange,
}: Props) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!customerId) return;
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
        throw new Error(json.error ?? "客户详情加载失败");
      }
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "客户详情加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!open || !customerId) return;
    deferEffectTask(() => {
      void load();
    });
  }, [open, customerId, load]);

  const customer = data?.customer;

  return (
    <AdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={customer?.name ?? "客户详情"}
      description={
        customer
          ? `${customer.totalOrders} 单 · 累计 ${formatCurrency(customer.totalSpent)}`
          : undefined
      }
      size="lg"
      closeOnOverlayClick
      loading={loading}
      bodyClassName="space-y-4"
      footer={
        <DrawerFooterActions
          onCancel={() => onOpenChange(false)}
          cancelLabel="关闭"
          hideConfirm={!customerId}
          confirmLabel="完整详情页"
          onConfirm={() => {
            if (customerId) {
              window.location.href = `/wms/crm/customers/${customerId}`;
            }
          }}
        />
      }
    >
      {loading ? (
        <p className="text-sm text-zinc-500">正在加载客户详情…</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : customer ? (
        <>
          <div className="flex items-center gap-2">
            <CustomerSourceBadge source={customer.source} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <p className="text-xs text-zinc-500">平均客单价</p>
              <p className="font-semibold">
                {formatCurrency(customer.averageOrderValue)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <p className="text-xs text-zinc-500">最近购买</p>
              <p className="font-semibold">
                {formatDateTime(customer.lastOrderAt)}
              </p>
            </div>
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-500">手机号</dt>
              <dd>{customer.phoneMasked ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">微信昵称</dt>
              <dd>{customer.wechatNickname ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-zinc-500">备注</dt>
              <dd>{customer.note ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-zinc-500">标签</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {customer.tags?.length
                  ? customer.tags.map((tag) => (
                      <Badge key={tag} variant="default">
                        {tag}
                      </Badge>
                    ))
                  : "—"}
              </dd>
            </div>
          </dl>

          {data.recipients.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-zinc-800">常用收花人</h4>
              <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                {data.recipients.slice(0, 5).map((r, i) => (
                  <li key={`${r.name}-${i}`}>
                    {r.name}
                    {r.relationLabel ? `（${r.relationLabel}）` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.reminders.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-zinc-800">待跟进提醒</h4>
              <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                {data.reminders.slice(0, 5).map((r) => (
                  <li key={r.id}>{r.title}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <Link
            href={`/wms/crm/customers/${customer.id}`}
            className="inline-block text-sm text-emerald-700 hover:underline"
          >
            打开完整客户详情页 →
          </Link>
        </>
      ) : null}
    </AdminDrawer>
  );
}
