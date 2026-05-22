"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WastageBatchRow } from "./types";

const REASON_OPTIONS = ["自然枯萎","制作折损","运输破损","其他"] as const;

type WastageFormProps = {
  selected: WastageBatchRow | null;
  onClearSelection: () => void;
};

export function WastageForm({ selected, onClearSelection }: WastageFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [wastageQty, setWastageQty] = useState("");

  useEffect(() => {
    setWastageQty("");
  }, [selected?.id]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!selected) {
      alert("请先在左侧列表点击「选择报损」");
      return;
    }

    const form = e.currentTarget;
    const fd = new FormData(form);
    const qty = Number(wastageQty || fd.get("wastageQty"));
    const reason = String(fd.get("reason") ?? "");
    const note = String(fd.get("note") ?? "").trim();
    const operatorId = String(fd.get("operatorId") ?? "").trim();

    if (!Number.isInteger(qty) || qty <= 0) {
      alert("损耗数量须为正整数");
      return;
    }
    if (qty > selected.remainingQty) {
      alert("报损数量不能大于当前批次剩余库存");
      return;
    }
    if (!reason) {
      alert("请选择损耗原因");
      return;
    }
    if (!operatorId) {
      alert("请填写操作员");
      return;
    }

    const fullReason = note
      ? `${reason}（${note}）`
      : reason;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/wastage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: selected.id,
          wastageQty: qty,
          reason: fullReason,
          operatorId,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };

      if (!res.ok || !json.success) {
        alert(json.error ?? "损耗核销失败");
        return;
      }

      alert(json.data?.message ?? "损耗核销成功");
      form.reset();
      setWastageQty("");
      onClearSelection();
      router.refresh();
    } catch {
      alert("网络异常，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const maxQty = selected?.remainingQty ?? 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-rose-100 bg-white p-6 shadow-sm"
    >
      <h3 className="text-sm font-semibold text-rose-900">{"报损核销表单"}</h3>

      <div className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{"已选批次"}</span>
        {selected ? (
          <div className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2 text-zinc-800">
            <p className="font-medium">{selected.productName}</p>
            <p className="mt-1 text-xs text-zinc-600">
              {"批次号"} {selected.batchNo ?? "—"} {"·"} {"剩余"} {selected.remainingQty}{" "}
              {selected.productUnit}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-sm text-zinc-400">
            {"请从左侧选择要报损的批次"}
          </p>
        )}
        <input type="hidden" name="batchId" value={selected?.id ?? ""} readOnly />
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{"损耗数量"}</span>
        <input
          name="wastageQty"
          type="number"
          min={1}
          max={maxQty || undefined}
          step={1}
          value={wastageQty}
          onChange={(e) => setWastageQty(e.target.value)}
          disabled={!selected}
          placeholder="1"          
          required
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-50"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{"损耗原因"}</span>
        <select
          name="reason"
          required
          disabled={!selected}
          defaultValue=""
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-50"
        >
          <option value="" disabled>
            {"请选择"}
          </option>
          {REASON_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-zinc-700">{"备注说明"}</span>
        <textarea
          name="note"
          rows={3}
          disabled={!selected}
          placeholder="可选，如：冷库 A 区发现整扎枯萎"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50"
        />
      </label>

      <Input
        name="operatorId"
        label="操作员"
        placeholder="小陈"
        required
        disabled={!selected}
      />

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={!selected || submitting}>
          {submitting ? "处理中…" : "确认报损"}
        </Button>
        {selected && (
          <Button
            type="button"
            variant="secondary"
            onClick={onClearSelection}
            disabled={submitting}
          >
            {"取消报损"}
          </Button>
        )}
      </div>
    </form>
  );
}
