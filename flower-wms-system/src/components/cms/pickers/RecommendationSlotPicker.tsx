"use client";

import { useEffect, useState } from "react";
import type { RecommendationSlotPickerItem } from "@/components/cms/pickers/types";

type Props = {
  value: string | null;
  onChange: (slotKey: string | null, slot?: RecommendationSlotPickerItem | null) => void;
  disabled?: boolean;
  label?: string;
};

export function RecommendationSlotPicker({
  value,
  onChange,
  disabled,
  label = "选择推荐位",
}: Props) {
  const [slots, setSlots] = useState<RecommendationSlotPickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          "/api/admin/cms/recommendation-slots?lite=true"
        );
        const json = (await res.json()) as {
          success?: boolean;
          error?: string;
          data?: { slots?: RecommendationSlotPickerItem[] };
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "推荐位加载失败");
        }
        if (!cancelled) setSlots(json.data?.slots ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "推荐位加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = slots.find((s) => s.key === value);
  const missing = value && !loading && !selected;

  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled || loading}
        onChange={(e) => {
          const key = e.target.value || null;
          const slot = slots.find((s) => s.key === key) ?? null;
          onChange(key, slot);
        }}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2"
      >
        <option value="">{loading ? "加载中…" : "请选择推荐位"}</option>
        {slots.map((slot) => (
          <option key={slot.id} value={slot.key}>
            {slot.name}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {missing ? (
        <p className="text-xs text-amber-700">关联对象不存在或已删除</p>
      ) : null}
    </label>
  );
}
