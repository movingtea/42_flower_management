"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { FloralRole } from "@/generated/prisma/enums";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";
import { ORDER_TOTAL_QUANTITY_HINT_THRESHOLD } from "@/lib/store-delivery-settings";
import type { OrderFulfillmentDetail } from "@/services/order-fulfillment-detail";
import type {
  LossAdjustedCostPreview,
  OrderCostSnapshotDto,
} from "@/services/order-cost";
import type {
  FlowerMaterialCostLine,
  PackagingCostLine,
} from "@/services/order-cost-pure";

type Props = {
  orderId: string;
  onClose: () => void;
};

type ApiResponse = {
  success: boolean;
  data?: OrderFulfillmentDetail;
  error?: string;
};

type CostDetail = {
  snapshot: OrderCostSnapshotDto;
  lossAdjustedPreview: LossAdjustedCostPreview;
  flowerMaterialCostLines: FlowerMaterialCostLine[];
  packagingCostLines: PackagingCostLine[];
  warnings: string[];
};

type CostApiResponse = {
  success: boolean;
  data?: CostDetail;
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

function formatPercent(value: string) {
  const pct = Number(value) * 100;
  return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "0.0%";
}

export function OrderDetailModal({ orderId, onClose }: Props) {
  const [detail, setDetail] = useState<OrderFulfillmentDetail | null>(null);
  const [costDetail, setCostDetail] = useState<CostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [costLoading, setCostLoading] = useState(false);
  const [savingDeliveryCost, setSavingDeliveryCost] = useState(false);
  const [deliveryCostActual, setDeliveryCostActual] = useState("0.00");
  const [deliveryCostNote, setDeliveryCostNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [lossImpactOpen, setLossImpactOpen] = useState(false);

  const loadCost = useCallback(async () => {
    setCostLoading(true);
    setCostError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cost`);
      const json = (await res.json()) as CostApiResponse;
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || "加载成本失败");
      }
      setCostDetail(json.data);
      setDeliveryCostActual(json.data.snapshot.deliveryCostActual);
    } catch (e) {
      setCostError(e instanceof Error ? e.message : "加载成本失败");
      setCostDetail(null);
    } finally {
      setCostLoading(false);
    }
  }, [orderId]);

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
        if (!cancelled) {
          setDetail(json.data);
          setDeliveryCostActual(json.data.deliveryCostActual);
          setDeliveryCostNote(json.data.deliveryCostNote ?? "");
        }
        await loadCost();
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
  }, [loadCost, orderId]);

  async function saveDeliveryCost() {
    const value = Number(deliveryCostActual);
    if (!Number.isFinite(value) || value < 0) {
      setCostError("配送实际成本须为非负数字");
      return;
    }
    setSavingDeliveryCost(true);
    setCostError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/delivery-cost`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryCostActual: value,
          deliveryCostNote: deliveryCostNote.trim() || null,
        }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存配送成本失败");
      }
      await loadCost();
    } catch (e) {
      setCostError(e instanceof Error ? e.message : "保存配送成本失败");
    } finally {
      setSavingDeliveryCost(false);
    }
  }

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
        className="flex max-h-[min(92vh,44rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
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

              {detail.items.reduce((sum, line) => sum + line.quantity, 0) >=
              ORDER_TOTAL_QUANTITY_HINT_THRESHOLD ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  该订单数量较多，请确认备花、制作和配送能力。
                </p>
              ) : null}

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

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h4 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    成本与毛利
                  </h4>
                  {costDetail?.snapshot.isPreview && (
                    <p className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      成本预览，尚未写入快照
                    </p>
                  )}
                </div>

                {costLoading ? (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-100 px-4 py-3 text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    加载成本数据…
                  </div>
                ) : costError ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {costError}
                  </p>
                ) : costDetail ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {[
                        ["实收金额", `¥${costDetail.snapshot.paidAmount}`],
                        [
                          "花材实际成本",
                          `¥${costDetail.snapshot.flowerMaterialCost}`,
                        ],
                        ["包装成本", `¥${costDetail.snapshot.packagingCost}`],
                        [
                          "配送实际成本",
                          `¥${costDetail.snapshot.deliveryCostActual}`,
                        ],
                        ["总成本", `¥${costDetail.snapshot.totalCost}`],
                        ["毛利", `¥${costDetail.snapshot.grossProfit}`],
                        [
                          "毛利率",
                          formatPercent(costDetail.snapshot.grossMargin),
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2"
                        >
                          <p className="text-xs text-zinc-500">{label}</p>
                          <p className="mt-0.5 text-sm font-semibold text-zinc-900">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-medium text-emerald-900">
                            配送实际成本
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={deliveryCostActual}
                            onChange={(e) =>
                              setDeliveryCostActual(e.target.value)
                            }
                            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-xs font-medium text-emerald-900">
                            备注
                          </span>
                          <input
                            value={deliveryCostNote}
                            onChange={(e) => setDeliveryCostNote(e.target.value)}
                            placeholder="例如：同城跑腿 / 自配送油费"
                            className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={savingDeliveryCost}
                          onClick={() => void saveDeliveryCost()}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          {savingDeliveryCost ? "保存中…" : "保存并重算"}
                        </button>
                      </div>
                    </div>

                    {costDetail.warnings.length > 0 && (
                      <ul className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                        {costDetail.warnings.map((warning, i) => (
                          <li key={`${detail.id}-cost-warning-${i}`}>
                            {warning}
                          </li>
                        ))}
                      </ul>
                    )}

                    <details
                      open={lossImpactOpen}
                      onToggle={(e) =>
                        setLossImpactOpen(
                          (e.currentTarget as HTMLDetailsElement).open
                        )
                      }
                      className="rounded-xl border border-sky-100 bg-sky-50/40 p-4"
                    >
                      <summary className="cursor-pointer text-sm font-semibold text-sky-900">
                        损耗模型影响
                      </summary>
                      <p className="mt-2 text-xs text-sky-800">
                        损耗模型不会改变历史库存流水，只用于帮助判断真实经营毛利。
                      </p>
                      {costDetail.flowerMaterialCostLines.length === 0 ? (
                        <p className="mt-3 text-sm text-zinc-500">
                          支付后可计算损耗模型影响。
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {[
                            [
                              "原始花材成本",
                              `¥${costDetail.lossAdjustedPreview.flowerMaterialCostRaw}`,
                            ],
                            [
                              "损耗调整后花材成本",
                              `¥${costDetail.lossAdjustedPreview.flowerMaterialCostLossAdjusted}`,
                            ],
                            [
                              "损耗模型增加成本",
                              `¥${costDetail.lossAdjustedPreview.lossModelExtraCost}`,
                            ],
                            [
                              "原始总成本",
                              `¥${costDetail.snapshot.totalCost}`,
                            ],
                            [
                              "损耗调整后总成本",
                              `¥${costDetail.lossAdjustedPreview.totalCostLossAdjusted}`,
                            ],
                            [
                              "原始毛利率",
                              formatPercent(costDetail.snapshot.grossMargin),
                            ],
                            [
                              "损耗调整后毛利率",
                              formatPercent(
                                costDetail.lossAdjustedPreview
                                  .grossMarginLossAdjusted
                              ),
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-sky-100 bg-white px-3 py-2"
                            >
                              <p className="text-xs text-zinc-500">{label}</p>
                              <p className="mt-0.5 text-sm font-semibold text-zinc-900">
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </details>

                    <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-sm">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                            <th className="px-3 py-2.5">花材名</th>
                            <th className="px-3 py-2.5">批次号</th>
                            <th className="px-3 py-2.5 text-right">数量</th>
                            <th className="px-3 py-2.5 text-right">原始单价</th>
                            <th className="px-3 py-2.5 text-right">损耗后单价</th>
                            <th className="px-3 py-2.5 text-right">可用率</th>
                            <th className="px-3 py-2.5 text-right">原始小计</th>
                            <th className="px-3 py-2.5 text-right">成本差额</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {costDetail.flowerMaterialCostLines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={8}
                                className="px-3 py-4 text-center text-zinc-500"
                              >
                                暂无花材成本明细
                              </td>
                            </tr>
                          ) : (
                            costDetail.flowerMaterialCostLines.map((row) => (
                              <tr key={row.stockLogId}>
                                <td className="px-3 py-2.5 font-medium text-zinc-900">
                                  {row.wikiName}
                                </td>
                                <td className="px-3 py-2.5 font-mono text-xs">
                                  {row.batchNo ?? row.batchId}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {row.quantity}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  ¥{row.unitCost}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  ¥{row.lossAdjustedUnitCost}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {row.usableRate
                                    ? formatPercent(row.usableRate)
                                    : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold">
                                  ¥{row.rawLineCost}
                                </td>
                                <td className="px-3 py-2.5 text-right text-sky-700">
                                  ¥{row.lossModelExtraCost}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-sm">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                            <th className="px-3 py-2.5">商品 / SKU</th>
                            <th className="px-3 py-2.5">Recipe</th>
                            <th className="px-3 py-2.5">PackagingKit</th>
                            <th className="px-3 py-2.5 text-right">数量</th>
                            <th className="px-3 py-2.5 text-right">单套成本</th>
                            <th className="px-3 py-2.5 text-right">小计</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {costDetail.packagingCostLines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="px-3 py-4 text-center text-zinc-500"
                              >
                                暂无包装成本明细
                              </td>
                            </tr>
                          ) : (
                            costDetail.packagingCostLines.map((row) => (
                              <tr key={row.orderItemId}>
                                <td className="px-3 py-2.5 font-medium text-zinc-900">
                                  {row.productName}（{row.specName}）
                                </td>
                                <td className="px-3 py-2.5">
                                  {row.recipeName ?? row.recipeId}
                                </td>
                                <td className="px-3 py-2.5">
                                  {row.packagingKitName ?? row.packagingKitId}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {row.quantity}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  ¥{row.unitCost}
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold">
                                  ¥{row.lineCost}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
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
