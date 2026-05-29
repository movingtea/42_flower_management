"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { FloralRole } from "@/generated/prisma/enums";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";
import type { OrderFulfillmentDetail } from "@/services/order-fulfillment-detail";

type Props = {
  orderId: string;
  onClose: () => void;
};

type ApiResponse = {
  success: boolean;
  data?: OrderFulfillmentDetail;
  error?: string;
};

function roleBadgeClass(label: string) {
  switch (label) {
    case FLORAL_ROLE_LABEL[FloralRole.MAIN]:
      return "bg-rose-100 text-rose-800";
    case FLORAL_ROLE_LABEL[FloralRole.FILLER]:
      return "bg-violet-100 text-violet-800";
    case FLORAL_ROLE_LABEL[FloralRole.LINE]:
      return "bg-sky-100 text-sky-800";
    case FLORAL_ROLE_LABEL[FloralRole.FOLIAGE]:
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

export function OrderDetailModal({ orderId, onClose }: Props) {
  const [detail, setDetail] = useState<OrderFulfillmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/orders/${orderId}/detail`);
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || "加载失败");
        }
        if (!cancelled) setDetail(json.data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载失败");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        className="flex max-h-[min(92vh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            {detail ? (
              <>
                <p className="text-xs font-medium text-rose-600">
                  {detail.statusLabel}
                </p>
                <h3
                  id="order-detail-title"
                  className="mt-1 break-all text-sm font-bold text-zinc-900 md:text-base"
                >
                  {detail.orderNo}
                </h3>
              </>
            ) : (
              <h3
                id="order-detail-title"
                className="break-all text-sm font-bold text-zinc-900 md:text-base"
              >
                订单详情
              </h3>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭详情"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="size-4" strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              加载订单详情…
            </div>
          ) : error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </p>
          ) : detail ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/60 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-zinc-500">履约状态</p>
                  <p className="text-sm font-semibold text-rose-800">
                    {detail.statusLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-zinc-500">实付金额</p>
                  <p className="text-xl font-bold text-rose-800">
                    ¥{detail.payAmount}
                  </p>
                </div>
              </div>

              <section className="space-y-2">
                <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  收货信息
                </h4>
                <dl className="grid gap-2 text-sm">
                  <div className="rounded-lg bg-zinc-50 px-3 py-2">
                    <dt className="text-xs text-zinc-500">收件人</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900">
                      {detail.receiverName}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-zinc-50 px-3 py-2">
                    <dt className="text-xs text-zinc-500">联系电话</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900">
                      {detail.receiverPhone}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-zinc-50 px-3 py-2">
                    <dt className="text-xs text-zinc-500">配送地址</dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-900">
                      {detail.deliveryAddress}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2.5">
                  <p className="text-xs font-medium text-amber-900/70">
                    期望送达时间
                  </p>
                  <p className="mt-1 text-sm font-semibold text-amber-950">
                    {detail.deliveryDate || "未填写"}
                  </p>
                </div>
                <div className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2.5 sm:col-span-2">
                  <p className="text-xs font-medium text-rose-800/70">贺卡寄语</p>
                  <p className="mt-1 text-sm font-medium whitespace-pre-wrap text-rose-900">
                    {detail.greetingCard?.trim() || "无贺卡寄语"}
                  </p>
                </div>
              </section>

              <section>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  商品明细
                </h4>
                <ul className="space-y-1 rounded-lg border border-zinc-100 px-3 py-2 text-sm">
                  {detail.items.map((line, i) => (
                    <li
                      key={`${detail.id}-item-${i}`}
                      className="flex justify-between gap-2 text-zinc-800"
                    >
                      <span className="min-w-0">{line.label}</span>
                      <span className="shrink-0 font-medium">× {line.quantity}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    WMS 物理花材消耗
                  </h4>
                  <p className="text-xs text-zinc-500">
                    {detail.consumptionMode === "locked"
                      ? "已按 FIFO 锁定物理批次"
                      : detail.consumptionMode === "projected"
                        ? "配方预估（支付后锁定批次）"
                        : "暂无配方消耗数据"}
                  </p>
                </div>

                {detail.physicalConsumption.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-sm">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                          <th className="px-3 py-2.5">花材母表名称</th>
                          <th className="px-3 py-2.5">工艺角色</th>
                          <th className="px-3 py-2.5">锁定批次号</th>
                          <th className="px-3 py-2.5 text-right">消耗数量</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {detail.physicalConsumption.map((row) => (
                          <tr
                            key={row.id}
                            className="bg-white transition-colors hover:bg-rose-50/30"
                          >
                            <td className="px-3 py-2.5 font-medium text-zinc-900">
                              {row.wikiName}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(row.floralRoleLabel)}`}
                              >
                                {row.floralRoleLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs text-zinc-700">
                              {row.batchNo ?? (
                                <span className="text-zinc-400">待支付锁定</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-rose-800">
                              {row.quantity} 支
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
                    该订单未绑定标准配方或尚无物理扣减记录
                  </p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
