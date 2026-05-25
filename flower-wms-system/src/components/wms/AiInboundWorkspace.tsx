"use client";

import Image from "next/image";
import { useState } from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { ImageUploadZone } from "@/components/shared/ImageUploadZone";
import { QuantityStepper } from "@/components/shared/QuantityStepper";
import { Button } from "@/components/ui/button";
import { ToastStack } from "@/components/ui/ToastStack";
import { useToast } from "@/hooks/useToast";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";
import type { WikiListItem } from "@/lib/wiki-constants";
import { FloralRole } from "@/generated/prisma/enums";

type TrackA = { track: "A"; wiki: WikiListItem };
type TrackB = {
  track: "B";
  draft: {
    englishName: string;
    chineseName: string;
    colorTags: string[];
    morphology: string;
    supplySeason: string;
    floralRole: FloralRole;
    maintenance: string;
    suggestedAliases: string[];
  };
};

export function AiInboundWorkspace() {
  const { toasts, show, dismiss } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackA | TrackB | null>(null);
  const [qty, setQty] = useState(10);
  const [unitCost, setUnitCost] = useState("2.5");
  const [supplier, setSupplier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  async function handleImage(prepared: {
    base64: string;
    mimeType: string;
    dataUrl: string;
  }) {
    setPreviewUrl(prepared.dataUrl);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/wms/inbound/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: prepared.base64,
          mimeType: prepared.mimeType,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: TrackA | TrackB;
      };
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "识别失败");
      }
      setResult(json.data);
      setSheetOpen(true);
      show(
        json.data.track === "A" ? "命中母表" : "未命中，AI 已脑补",
        "success"
      );
    } catch (e) {
      show(e instanceof Error ? e.message : "识别失败", "error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmInbound() {
    if (!result) return;
    setSubmitting(true);
    try {
      const payload =
        result.track === "A"
          ? {
              wikiId: result.wiki.id,
              receivedQty: qty,
              unitCost: Number(unitCost),
              supplier: supplier || undefined,
            }
          : {
              wikiDraft: {
                englishName: result.draft.englishName,
                chineseName: result.draft.chineseName,
                colorTags: result.draft.colorTags,
                morphology: result.draft.morphology,
                supplySeason: result.draft.supplySeason,
                floralRole: result.draft.floralRole,
                maintenance: result.draft.maintenance,
                suggestedAliases: result.draft.suggestedAliases,
              },
              receivedQty: qty,
              unitCost: Number(unitCost),
              supplier: supplier || undefined,
            };

      const res = await fetch("/api/admin/wms/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { batch?: { batchNo?: string } };
      };
      if (!res.ok || !json.success) throw new Error(json.error ?? "入库失败");
      show(`入库成功 · 批次 ${json.data?.batch?.batchNo ?? ""}`, "success");
      setResult(null);
      setSheetOpen(false);
      setPreviewUrl(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "入库失败", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const wiki =
    result?.track === "A"
      ? result.wiki
      : result?.track === "B"
        ? result.draft
        : null;

  const panel = (
    <div className="space-y-4">
        {wiki ? (
          <>
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {result?.track === "A" ? "🟢 轨道 A · 母表命中" : "🟡 轨道 B · AI 脑补"}
            </div>
            <p className="font-semibold text-zinc-900">
              {wiki.chineseName}{" "}
              <span className="text-sm font-normal italic text-zinc-500">
                {wiki.englishName}
              </span>
            </p>
            <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
              {FLORAL_ROLE_LABEL[wiki.floralRole]}
            </span>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-amber-50/80 p-3 text-sm leading-relaxed text-amber-950">
              {wiki.maintenance}
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">上传花材照片后开始识别</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            入库数量
            <div className="mt-1">
              <QuantityStepper value={qty} onChange={setQty} />
            </div>
          </label>
          <label className="text-sm">
            进货单价（元）
            <input
              type="number"
              min={0}
              step={0.01}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            供应商
            <input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="选填"
            />
          </label>
        </div>

        <Button
          type="button"
          disabled={submitting || !result}
          onClick={() => void confirmInbound()}
        >
          {submitting ? "入库中…" : "确认入库"}
        </Button>
      </div>
  );

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <ImageUploadZone
            label="📸 上传单种花材到货照片 · AI 识别入库"
            capture
            onReady={handleImage}
            disabled={loading}
          />
          {loading && (
            <p className="animate-pulse text-center text-sm font-medium text-violet-800">
              DeepSeek 正在识别拉丁学名并撞库…
            </p>
          )}
          {previewUrl ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl border">
              <Image src={previewUrl} alt="花材" fill className="object-cover" unoptimized />
            </div>
          ) : null}
        </div>
        <div className="hidden md:block">
          <div className="sticky top-4 rounded-xl border bg-white p-5 shadow-sm">
            <h3 className="mb-4 font-semibold text-zinc-900">入库面板</h3>
            {panel}
          </div>
        </div>
      </div>
      <BottomSheet open={sheetOpen && !!result} onClose={() => setSheetOpen(false)} title="智能入库">
        {panel}
      </BottomSheet>
    </>
  );
}
