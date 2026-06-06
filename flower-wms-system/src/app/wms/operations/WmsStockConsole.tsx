"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BatchPipelinePanel } from "@/app/wms/operations/BatchPipelinePanel";
import { QuantityStepper } from "@/components/shared/QuantityStepper";
import { FlowerMaterialSelect } from "@/components/ui/FlowerMaterialSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WikiListItem } from "@/lib/wiki-constants";
import type {
  BatchPipelineRow,
  WikiBatchOption,
} from "@/services/wms-stock";

const LOSS_REASONS = ["自然开败", "制作折损", "运输破损", "其他"] as const;

type Panel = "inbound" | "loss";

type Props = {
  initialPipeline: BatchPipelineRow[];
  defaultPanel?: Panel;
};

function formatBatchOptionLabel(batch: WikiBatchOption): string {
  const date = new Date(batch.createdAt).toLocaleDateString("zh-CN");
  const supplier = batch.supplier?.trim() || "未知";
  return `批次: ${date} - 剩余: ${batch.remainingQty}${batch.unit} - 进价: ¥${batch.unitCost} - 供应商: ${supplier}`;
}

export function WmsStockConsole({
  initialPipeline,
  defaultPanel = "inbound",
}: Props) {
  const router = useRouter();
  const [pipeline, setPipeline] = useState(initialPipeline);
  const [panel, setPanel] = useState<Panel>(defaultPanel);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const [inboundWikiId, setInboundWikiId] = useState<string | null>(null);
  const [inboundBundleCount, setInboundBundleCount] = useState(1);
  const [stemsPerBundle, setStemsPerBundle] = useState(10);
  const [costPricePerBundle, setCostPricePerBundle] = useState("");
  const [supplier, setSupplier] = useState("");
  const [inboundSubmitting, setInboundSubmitting] = useState(false);

  const [lossWikiId, setLossWikiId] = useState<string | null>(null);
  const [lossBatchId, setLossBatchId] = useState("");
  const [wikiBatches, setWikiBatches] = useState<WikiBatchOption[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [lossQty, setLossQty] = useState(1);
  const [lossReason, setLossReason] = useState("");
  const [lossNote, setLossNote] = useState("");
  const [lossSubmitting, setLossSubmitting] = useState(false);

  const selectedBatch = wikiBatches.find((b) => b.batchId === lossBatchId);
  const lossMaxQty = selectedBatch?.remainingQty ?? 0;

  const inboundTotalStems = inboundBundleCount * stemsPerBundle;
  const parsedBundlePrice = Number(costPricePerBundle);
  const inboundUnitStemCost =
    stemsPerBundle > 0 &&
    Number.isFinite(parsedBundlePrice) &&
    parsedBundlePrice >= 0
      ? parsedBundlePrice / stemsPerBundle
      : null;

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    setPipeline(initialPipeline);
  }, [initialPipeline]);

  useEffect(() => {
    if (!lossWikiId) {
      setWikiBatches([]);
      setLossBatchId("");
      setLossQty(1);
      return;
    }

    let cancelled = false;
    setBatchesLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/wms/stock-batches?flowerWikiId=${encodeURIComponent(lossWikiId)}`
        );
        const json = (await res.json()) as {
          success?: boolean;
          data?: { items?: WikiBatchOption[] };
        };
        if (cancelled) return;
        if (res.ok && json.success && json.data?.items) {
          setWikiBatches(json.data.items);
        } else {
          setWikiBatches([]);
        }
      } catch {
        if (!cancelled) setWikiBatches([]);
      } finally {
        if (!cancelled) setBatchesLoading(false);
      }
    })();

    setLossBatchId("");
    setLossQty(1);

    return () => {
      cancelled = true;
    };
  }, [lossWikiId]);

  useEffect(() => {
    if (lossMaxQty <= 0) return;
    setLossQty((prev) => Math.min(Math.max(1, prev), lossMaxQty));
  }, [lossMaxQty, lossBatchId]);

  async function refreshPipeline() {
    router.refresh();
    try {
      const res = await fetch("/api/admin/wms/stock-pipeline");
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: BatchPipelineRow[] };
      };
      if (res.ok && json.success && json.data?.items) {
        setPipeline(json.data.items);
      }
    } catch {
      /* ignore */
    }
  }

  function onInboundWikiChange(item: WikiListItem | null) {
    setInboundWikiId(item?.id ?? null);
  }

  function onLossWikiChange(item: WikiListItem | null) {
    setLossWikiId(item?.id ?? null);
  }

  async function handleInboundSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inboundWikiId) {
      showToast("请先选择到货花材", "error");
      return;
    }
    const price = Number(costPricePerBundle);
    if (!Number.isFinite(price) || price < 0) {
      showToast("每束进货价无效", "error");
      return;
    }
    if (stemsPerBundle <= 0) {
      showToast("每束支数须大于 0", "error");
      return;
    }

    setInboundSubmitting(true);
    try {
      const res = await fetch("/api/admin/wms/stock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowerWikiId: inboundWikiId,
          bundleCount: inboundBundleCount,
          stemsPerBundle,
          costPricePerBundle: price,
          supplier: supplier.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        showToast(json.error ?? "入库失败", "error");
        return;
      }

      showToast(json.data?.message ?? "入库成功", "success");
      setInboundBundleCount(1);
      setStemsPerBundle(10);
      setCostPricePerBundle("");
      setSupplier("");
      await refreshPipeline();
    } catch {
      showToast("网络异常，请稍后重试", "error");
    } finally {
      setInboundSubmitting(false);
    }
  }

  async function handleLossSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lossWikiId) {
      showToast("请先选择报损花材", "error");
      return;
    }
    if (!lossBatchId) {
      showToast("请选择损耗发生的入库批次", "error");
      return;
    }
    if (lossQty > lossMaxQty) {
      showToast("报损数量超出该批次可用库存", "error");
      return;
    }
    if (!lossReason) {
      showToast("请选择损耗原因", "error");
      return;
    }

    const fullReason = lossNote.trim()
      ? `${lossReason}（${lossNote.trim()}）`
      : lossReason;

    setLossSubmitting(true);
    try {
      const res = await fetch("/api/admin/wms/stock-loss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowerWikiId: lossWikiId,
          stockBatchId: lossBatchId,
          lossQuantity: lossQty,
          reason: fullReason,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        showToast(json.error ?? "损耗核销失败", "error");
        return;
      }

      showToast(json.data?.message ?? "损耗核销成功", "success");
      setLossQty(1);
      setLossReason("");
      setLossNote("");
      setLossBatchId("");
      await refreshPipeline();
      if (lossWikiId) {
        const batchRes = await fetch(
          `/api/admin/wms/stock-batches?flowerWikiId=${encodeURIComponent(lossWikiId)}`
        );
        const batchJson = (await batchRes.json()) as {
          success?: boolean;
          data?: { items?: WikiBatchOption[] };
        };
        if (batchRes.ok && batchJson.success && batchJson.data?.items) {
          setWikiBatches(batchJson.data.items);
        }
      }
    } catch {
      showToast("网络异常，请稍后重试", "error");
    } finally {
      setLossSubmitting(false);
    }
  }

  const lossStepperReady =
    !!lossWikiId && !!lossBatchId && lossMaxQty > 0;

  return (
    <div className="relative">
      <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:gap-8 md:items-start">
        <section className="order-2 md:order-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">
              批次库存流水线
            </h3>
            <span className="text-xs text-zinc-500">
              {pipeline.length} 个在库批次
            </span>
          </div>
          <BatchPipelinePanel pipeline={pipeline} />
        </section>

        <section className="order-1 md:order-2">
          <div className="mb-4 flex gap-2 rounded-xl border border-zinc-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setPanel("inbound")}
              className={`min-h-[44px] flex-1 rounded-lg text-sm font-medium transition-colors ${
                panel === "inbound"
                  ? "bg-rose-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              📥 采购到货入库
            </button>
            <button
              type="button"
              onClick={() => setPanel("loss")}
              className={`min-h-[44px] flex-1 rounded-lg text-sm font-medium transition-colors ${
                panel === "loss"
                  ? "bg-rose-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              📉 物理报损盘点
            </button>
          </div>

          {panel === "inbound" ? (
            <form
              onSubmit={handleInboundSubmit}
              className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm md:p-6"
            >
              <h3 className="text-sm font-semibold text-zinc-900">
                采购到货入库
              </h3>

              <label className="block text-sm">
                <span className="mb-2 block font-medium text-zinc-700">
                  花材选择（简拼 / 中文 / 拉丁名）
                </span>
                <FlowerMaterialSelect
                  value={inboundWikiId}
                  onChange={onInboundWikiChange}
                  disabled={inboundSubmitting}
                />
              </label>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">
                  到货束数
                </label>
                <QuantityStepper
                  value={inboundBundleCount}
                  min={1}
                  onChange={setInboundBundleCount}
                  disabled={inboundSubmitting}
                  aria-label="到货束数"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">
                  每束支数
                </label>
                <QuantityStepper
                  value={stemsPerBundle}
                  min={1}
                  onChange={setStemsPerBundle}
                  disabled={inboundSubmitting}
                  aria-label="每束支数"
                />
              </div>

              <Input
                label="每束进货价（元）"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                placeholder="25.00"
                value={costPricePerBundle}
                onChange={(e) => setCostPricePerBundle(e.target.value)}
                disabled={inboundSubmitting}
                required
              />

              {inboundTotalStems > 0 && inboundUnitStemCost != null && (
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  合计入库{" "}
                  <span className="font-semibold text-zinc-900">
                    {inboundTotalStems} 支
                  </span>
                  ，折合单支成本 ¥{inboundUnitStemCost.toFixed(4)}
                </p>
              )}

              <Input
                label="供应商"
                placeholder="选填"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                disabled={inboundSubmitting}
              />

              <Button
                type="submit"
                disabled={inboundSubmitting || !inboundWikiId}
                className="min-h-[44px] w-full py-3 text-base"
              >
                {inboundSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    入库提交中…
                  </span>
                ) : (
                  "确认入库"
                )}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleLossSubmit}
              className="space-y-5 rounded-xl border border-rose-100 bg-white p-5 shadow-sm md:p-6"
            >
              <h3 className="text-sm font-semibold text-rose-900">
                物理报损盘点
              </h3>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                提示：请选择实际发生物理损耗的花材批次进行扣减。
              </p>

              <label className="block text-sm">
                <span className="mb-2 block font-medium text-zinc-700">
                  花材选择（简拼 / 中文 / 拉丁名）
                </span>
                <FlowerMaterialSelect
                  value={lossWikiId}
                  onChange={onLossWikiChange}
                  disabled={lossSubmitting}
                />
              </label>

              {lossWikiId && (
                <label className="block text-sm">
                  <span className="mb-2 block font-medium text-zinc-700">
                    📦 请选择损耗发生的入库批次
                  </span>
                  {batchesLoading ? (
                    <p className="text-sm text-zinc-400">加载批次中…</p>
                  ) : wikiBatches.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-500">
                      该花材暂无可用库存批次
                    </p>
                  ) : (
                    <select
                      value={lossBatchId}
                      onChange={(e) => {
                        setLossBatchId(e.target.value);
                        setLossQty(1);
                      }}
                      disabled={lossSubmitting}
                      className="min-h-[44px] w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50"
                    >
                      <option value="">请选择入库批次</option>
                      {wikiBatches.map((batch) => (
                        <option key={batch.batchId} value={batch.batchId}>
                          {formatBatchOptionLabel(batch)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700">
                  损耗数量
                </label>
                <QuantityStepper
                  value={lossQty}
                  min={1}
                  max={lossMaxQty > 0 ? lossMaxQty : undefined}
                  onChange={setLossQty}
                  disabled={!lossStepperReady || lossSubmitting}
                  aria-label="损耗数量"
                />
                {selectedBatch && (
                  <p className="mt-1 text-xs text-zinc-500">
                    本批次最多可报损 {lossMaxQty} {selectedBatch.unit}
                  </p>
                )}
              </div>

              <label className="block text-sm">
                <span className="mb-2 block font-medium text-zinc-700">
                  损耗原因
                </span>
                <select
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                  disabled={lossSubmitting}
                  required
                  className="min-h-[44px] w-full rounded-lg border border-zinc-200 px-3 py-2 text-base disabled:bg-zinc-50"
                >
                  <option value="" disabled>
                    请选择
                  </option>
                  {LOSS_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-2 block font-medium text-zinc-700">
                  备注说明
                </span>
                <textarea
                  rows={3}
                  value={lossNote}
                  onChange={(e) => setLossNote(e.target.value)}
                  disabled={lossSubmitting}
                  placeholder="可选，如：冷库 A 区整扎开败"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50"
                />
              </label>

              <Button
                type="submit"
                disabled={lossSubmitting || !lossStepperReady || !lossReason}
                className="min-h-[44px] w-full py-3 text-base"
              >
                {lossSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    报损提交中…
                  </span>
                ) : (
                  "确认报损"
                )}
              </Button>
            </form>
          )}
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
