"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { BottomSheet } from "@/components/shared/BottomSheet";
import { ImageUploadZone } from "@/components/shared/ImageUploadZone";
import { QuantityStepper } from "@/components/shared/QuantityStepper";
import { SwipeRow } from "@/components/shared/SwipeRow";
import { Button } from "@/components/ui/button";
import { ToastStack } from "@/components/ui/ToastStack";
import { useToast } from "@/hooks/useToast";
import type { BouquetDraftLine } from "@/lib/wiki-constants";
import { FLORAL_ROLE_LABEL } from "@/lib/wiki-constants";

type Props = {
  spuId: string;
  disabled?: boolean;
};

export function BomDraftWorkspace({ spuId, disabled }: Props) {
  const { toasts, show, dismiss } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lines, setLines] = useState<BouquetDraftLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const updateLine = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l))
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  async function handleBouquetImage(prepared: {
    base64: string;
    mimeType: string;
    dataUrl: string;
  }) {
    setPreviewUrl(prepared.dataUrl);
    setLoading(true);
    try {
      const res = await fetch(
        "/api/admin/ai/vision?mode=bouquet",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64: prepared.base64,
            mimeType: prepared.mimeType,
          }),
        }
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { lines?: BouquetDraftLine[] };
      };
      if (!res.ok || !json.success || !json.data?.lines) {
        throw new Error(json.error ?? "拆解失败");
      }
      setLines(json.data.lines);
      setSheetOpen(true);
      show("AI 配方草稿已生成（仅内存，未落库）", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "拆解失败", "error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmSave() {
    if (lines.length === 0) {
      show("请先上传花束并生成配方", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${spuId}/bom`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            englishName: l.englishName,
            quantity: l.quantity,
          })),
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "落库失败");
      }
      show("配方已写入 product_bom", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "落库失败", "error");
    } finally {
      setSaving(false);
    }
  }

  const chipList = (
    <ul className="space-y-3">
      {lines.length === 0 ? (
        <li className="text-sm text-zinc-500">上传花束照片后 AI 将生成草稿芯片</li>
      ) : (
        lines.map((line) => (
          <li key={line.key}>
            <SwipeRow onDelete={() => removeLine(line.key)} className="border">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium text-zinc-900">
                    {line.chineseName} × {line.quantity}
                  </p>
                  <p className="text-xs italic text-zinc-500">{line.englishName}</p>
                  {line.floralRole ? (
                    <span className="mt-1 inline-block text-xs text-rose-700">
                      {FLORAL_ROLE_LABEL[line.floralRole]}
                    </span>
                  ) : null}
                </div>
                <QuantityStepper
                  value={line.quantity}
                  onChange={(q) => updateLine(line.key, q)}
                />
              </div>
            </SwipeRow>
          </li>
        ))
      )}
    </ul>
  );

  return (
    <section className="rounded-xl border border-violet-100 bg-white p-5 shadow-sm">
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <h3 className="text-sm font-semibold text-zinc-900">商品配方（BOM）</h3>
      <p className="mt-1 text-xs text-zinc-500">
        第一步 AI 内存预审，第二步确认后才写入数据库。不会修改商品描述富文本。
      </p>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <ImageUploadZone
            label="🤖 上传复合花束照片 · AI 拆解配方"
            capture
            onReady={handleBouquetImage}
            disabled={disabled || loading}
          />
          {loading && (
            <p className="text-sm text-violet-800">DeepSeek 正在剥洋葱式拆解配方…</p>
          )}
          {previewUrl ? (
            <div className="relative aspect-square max-h-80 overflow-hidden rounded-xl border">
              <Image
                src={previewUrl}
                alt="花束"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          ) : null}
        </div>
        <div className="hidden md:block">
          <div className="sticky top-4">
            <p className="mb-2 text-xs font-medium text-zinc-600">草稿芯片墙</p>
            {chipList}
            <Button
              type="button"
              className="mt-4 w-full"
              disabled={saving || lines.length === 0 || disabled}
              onClick={() => void confirmSave()}
            >
              {saving ? "落库中…" : "确认落库配方"}
            </Button>
          </div>
        </div>
      </div>

      <BottomSheet
        open={sheetOpen && lines.length > 0}
        onClose={() => setSheetOpen(false)}
        title="配方草稿"
      >
        {chipList}
        <Button
          type="button"
          className="mt-4 w-full"
          disabled={saving || disabled}
          onClick={() => void confirmSave()}
        >
          {saving ? "落库中…" : "确认落库配方"}
        </Button>
      </BottomSheet>

      <div className="mt-4 md:hidden">
        <Button
          type="button"
          className="w-full"
          disabled={saving || lines.length === 0 || disabled}
          onClick={() => void confirmSave()}
        >
          {saving ? "落库中…" : "确认落库配方"}
        </Button>
      </div>
    </section>
  );
}
