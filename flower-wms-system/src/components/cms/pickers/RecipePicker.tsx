"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipePickerItem } from "@/components/cms/pickers/types";

type Props = {
  value: string | null;
  onChange: (recipeId: string | null) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
};

export function RecipePicker({
  value,
  onChange,
  disabled,
  compact,
  label = "选择配方",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<RecipePickerItem[]>([]);
  const [selected, setSelected] = useState<RecipePickerItem | null>(null);
  const [missing, setMissing] = useState(false);

  const fetchItems = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (q.trim()) params.set("keyword", q.trim());
      const res = await fetch(`/api/admin/wms/recipes/search?${params}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: RecipePickerItem[] };
      };
      setItems(res.ok && json.success ? (json.data?.items ?? []) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!value) {
      setSelected(null);
      setMissing(false);
      return;
    }
    if (selected?.id === value) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/wms/recipes/search?keyword=${encodeURIComponent(value)}&limit=50`
        );
        const json = (await res.json()) as {
          data?: { items?: RecipePickerItem[] };
        };
        const hit = json.data?.items?.find((i) => i.id === value) ?? null;
        if (hit) {
          setSelected(hit);
          setMissing(false);
        } else {
          const res2 = await fetch(`/api/admin/wms/recipes?id=${encodeURIComponent(value)}`);
          const json2 = (await res2.json()) as {
            data?: {
              recipe?: {
                id: string;
                name: string;
                recipeCode: string;
                packagingKit?: { name: string } | null;
                standardCost?: { totalCost: string };
              };
            };
          };
          const r = json2.data?.recipe;
          if (r) {
            setSelected({
              id: r.id,
              name: r.name,
              bomNo: r.recipeCode,
              packagingKitName: r.packagingKit?.name ?? null,
              estimatedCost: r.standardCost?.totalCost ?? "—",
              ingredientSummary: "",
            });
            setMissing(false);
          } else {
            setMissing(true);
          }
        }
      } catch {
        setMissing(true);
      }
    })();
  }, [value, selected?.id]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void fetchItems(query), 280);
    return () => window.clearTimeout(timer);
  }, [open, query, fetchItems]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!compact) return;
    void fetchItems("");
  }, [compact, fetchItems]);

  if (compact) {
    return (
      <select
        value={value ?? ""}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full min-w-[12rem] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-400 disabled:bg-zinc-50"
      >
        <option value="">
          {loading ? "加载配方中…" : "— 暂不绑定配方 —"}
        </option>
        {value && missing ? (
          <option value={value}>关联对象不存在或已删除</option>
        ) : null}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.bomNo} - {item.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div ref={rootRef} className={compact ? "" : "space-y-2"}>
      {!compact && label ? (
        <span className="block text-sm font-medium text-zinc-800">{label}</span>
      ) : null}

      {selected ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
          <p className="font-medium text-zinc-900">{selected.name}</p>
          <p className="text-xs text-zinc-500">
            BOM {selected.bomNo}
            {selected.packagingKitName
              ? ` · 包装：${selected.packagingKitName}`
              : ""}
            {selected.estimatedCost ? ` · 成本 ¥${selected.estimatedCost}` : ""}
          </p>
          {!disabled ? (
            <button
              type="button"
              className="mt-1 text-xs text-zinc-500 hover:text-red-600"
              onClick={() => {
                onChange(null);
                setSelected(null);
              }}
            >
              清除绑定
            </button>
          ) : null}
        </div>
      ) : missing && value ? (
        <p className="text-sm text-amber-700">关联对象不存在或已删除</p>
      ) : null}

      {!disabled ? (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              void fetchItems(query);
            }}
            placeholder="搜索配方名称、BOM 编号…"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
          />
          {open ? (
            <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
              {loading ? (
                <p className="px-3 py-2 text-sm text-zinc-500">搜索中…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500">暂无匹配配方</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="block w-full border-b border-zinc-50 px-3 py-2 text-left hover:bg-rose-50/50"
                    onClick={() => {
                      setSelected(item);
                      onChange(item.id);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-zinc-500">
                      {item.bomNo}
                      {item.packagingKitName
                        ? ` · ${item.packagingKitName}`
                        : ""}
                      {item.estimatedCost ? ` · ¥${item.estimatedCost}` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!compact ? (
        <p className="text-xs text-zinc-500">
          配方在 WMS「标准配方研发中心」维护，单号由系统自动分配
        </p>
      ) : null}
    </div>
  );
}
