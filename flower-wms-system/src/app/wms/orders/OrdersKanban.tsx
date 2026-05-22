"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { KanbanColumnId, KanbanOrder } from "@/app/wms/orders/types";
import type { FulfillmentPhase } from "@/services/order-status";

const COLUMNS: {
  id: KanbanColumnId;
  phase: FulfillmentPhase;
  title: string;
  subtitle: string;
  actionLabel: string;
  nextStatus: string;
}[] = [
  {
    id: "PAID",
    phase: "PAID",
    title: "待制作",
    subtitle: "已付款，等待花艺师开工",
    actionLabel: "开始制作",
    nextStatus: "MAKING",
  },
  {
    id: "MAKING",
    phase: "MAKING",
    title: "花艺制作中",
    subtitle: "包装与质检",
    actionLabel: "发货配送",
    nextStatus: "DELIVERING",
  },
  {
    id: "DELIVERING",
    phase: "DELIVERING",
    title: "配送中",
    subtitle: "骑手 / 店员配送途中",
    actionLabel: "确认送达",
    nextStatus: "COMPLETED",
  },
];

function formatDeliveryTime(iso: string | null) {
  if (!iso) return "未指定送达时间";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OrderCard({
  order,
  actionLabel,
  loading,
  onAction,
}: {
  order: KanbanOrder;
  actionLabel: string;
  loading: boolean;
  onAction: () => void;
}) {
  return (
    <article className="rounded-xl border border-rose-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-zinc-900">{order.orderNo}</p>
        <span className="shrink-0 text-sm font-medium text-rose-600">
          {"\u00a5"}
          {order.totalAmount}
        </span>
      </div>

      <p
        className={`mt-2 text-sm font-medium ${
          order.isOverdue
            ? "animate-pulse text-red-600"
            : order.isUrgent
              ? "text-red-600"
              : "text-zinc-600"
        }`}
      >
        {"\u9001\u8fbe"} {formatDeliveryTime(order.deliveryTime)}
        {order.isOverdue && " \u00b7 \u5df2\u8d85\u65f6"}
        {order.isUrgent && !order.isOverdue && " \u00b7 \u52a0\u6025"}
      </p>

      <div className="mt-3 rounded-lg bg-rose-50/40 px-3 py-2 text-sm text-zinc-700">
        <p className="font-medium">{order.receiverName ?? "\u2014"}</p>
        <p>{order.receiverPhone ?? "\u2014"}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          {order.deliveryAddress ?? "\u2014"}
        </p>
      </div>

      <ul className="mt-3 space-y-1 text-sm text-zinc-600">
        {order.items.map((line, i) => (
          <li key={i}>
            {"\u00b7"} {line.label} {"\u00d7"} {line.quantity}
          </li>
        ))}
      </ul>

      <Button
        type="button"
        className="mt-4 w-full"
        disabled={loading}
        onClick={onAction}
      >
        {loading ? "处理中…" : actionLabel}
      </Button>
    </article>
  );
}

type Props = {
  orders: KanbanOrder[];
  pendingPayCount: number;
};

export function OrdersKanban({ orders, pendingPayCount }: Props) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
      window.setTimeout(() => setToast(null), 2800);
    },
    []
  );

  async function patchStatus(orderId: string, nextStatus: string) {
    setLoadingId(orderId);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, nextStatus }),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        showToast(json.error ?? "操作失败", "error");
        return;
      }

      showToast(json.data?.message ?? "状态已更新", "success");
      router.refresh();
    } catch {
      showToast("网络异常，请重试", "error");
    } finally {
      setLoadingId(null);
    }
  }

  const byPhase = (phase: FulfillmentPhase) =>
    orders.filter((o) => o.phase === phase);

  return (
    <div className="relative">
      {toast && (
        <div
          role="status"
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {pendingPayCount > 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
           "另有 " + {pendingPayCount}
            " 笔待付款订单未显示在看板中（需支付后进入履约流程）"
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = byPhase(col.phase);
          return (
            <section
              key={col.id}
              className="flex min-h-[320px] flex-col rounded-xl border border-zinc-200 bg-zinc-50/80"
            >
              <header className="rounded-t-xl border-b border-zinc-200 bg-white px-4 py-4">
                <h3 className="font-semibold text-zinc-900">{col.title}</h3>
                <p className="mt-0.5 text-xs text-zinc-500">{col.subtitle}</p>
                <span className="mt-2 inline-block rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800">
                  {list.length} {"单"}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-3 p-3">
                {list.length === 0 ? (
                  <p className="py-8 text-center text-sm text-zinc-400">
                    {"暂无订单"}
                  </p>
                ) : (
                  list.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      actionLabel={col.actionLabel}
                      loading={loadingId === order.id}
                      onAction={() => patchStatus(order.id, col.nextStatus)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
