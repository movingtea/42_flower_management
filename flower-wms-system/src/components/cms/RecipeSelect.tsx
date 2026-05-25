"use client";

import { useEffect, useState } from "react";

export type RecipeOption = {
  id: string;
  recipeCode: string;
  name: string;
  ingredientSummary: string;
  ingredientCount: number;
};

type Props = {
  value: string | null;
  onChange: (recipeId: string | null) => void;
  disabled?: boolean;
};

export function RecipeSelect({ value, onChange, disabled }: Props) {
  const [options, setOptions] = useState<RecipeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/wms/recipes");
        const json = (await res.json()) as {
          success?: boolean;
          data?: {
            items?: RecipeOption[];
          };
        };
        if (!res.ok || !json.success) {
          throw new Error("加载配方列表失败");
        }
        if (!cancelled) {
          setOptions(json.data?.items ?? []);
          setError("");
        }
      } catch {
        if (!cancelled) setError("无法加载大仓配方列表");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function optionLabel(opt: RecipeOption): string {
    const summary = opt.ingredientSummary || "未配置物料";
    return `${opt.recipeCode} - ${opt.name} (${summary})`;
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-zinc-800">
        🔌 绑定大仓生产配方
      </label>
      <select
        value={value ?? ""}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-400 disabled:bg-zinc-50"
      >
        <option value="">
          {loading ? "加载配方中…" : "— 暂不绑定配方 —"}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {optionLabel(opt)}
          </option>
        ))}
      </select>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-xs text-zinc-500">
        配方在 WMS「标准配方研发中心」维护，单号由系统自动分配
      </p>
    </div>
  );
}
