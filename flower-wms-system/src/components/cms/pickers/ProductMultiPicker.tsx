"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import type { ProductPickerItem } from "@/components/cms/pickers/types";

type Props = {
  value: string[];
  onChange: (productIds: string[]) => void;
  disabled?: boolean;
  label?: string;
};

export function ProductMultiPicker({
  value,
  onChange,
  disabled,
  label = "选择商品",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ProductPickerItem[]>([]);
  const [chips, setChips] = useState<ProductPickerItem[]>([]);

  const fetchItems = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (q.trim()) params.set("keyword", q.trim());
      const res = await fetch(`/api/admin/cms/products/search?${params}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { items?: ProductPickerItem[] };
      };
      setItems(res.ok && json.success ? (json.data?.items ?? []) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    deferEffectTask(() => {
      if (cancelled) return;
      if (value.length === 0) {
        setChips([]);
        return;
      }

      void (async () => {
        const resolved: ProductPickerItem[] = [];
        for (const id of value) {
          if (chips.some((c) => c.id === id)) {
            const hit = chips.find((c) => c.id === id);
            if (hit) resolved.push(hit);
            continue;
          }
          try {
            const res = await fetch(
              `/api/admin/cms/products/search?keyword=${encodeURIComponent(id)}&limit=50`
            );
            const json = (await res.json()) as {
              data?: { items?: ProductPickerItem[] };
            };
            const hit = json.data?.items?.find((i) => i.id === id);
            if (hit) resolved.push(hit);
            else {
              resolved.push({
                id,
                name: "关联对象不存在或已删除",
                categoryName: null,
                status: "inactive",
                coverImage: "",
                priceRange: "—",
                skuCount: 0,
                readinessStatus: "INCOMPLETE",
                productDecisionSummary: {
                  healthStatus: "UNKNOWN",
                  healthStatusLabel: "未知",
                },
              });
            }
          } catch {
            /* skip */
          }
        }
        if (!cancelled) setChips(resolved);
      })();
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chips resolved from value
  }, [value]);

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

  function addProduct(item: ProductPickerItem) {
    if (value.includes(item.id)) return;
    onChange([...value, item.id]);
    setOpen(false);
    setQuery("");
  }

  function removeProduct(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div ref={rootRef} className="space-y-2">
      {label ? (
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-900"
            >
              {chip.name}
              {!disabled ? (
                <button
                  type="button"
                  className="text-rose-400 hover:text-red-600"
                  onClick={() => removeProduct(chip.id)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
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
            placeholder="输入商品名搜索并添加…"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
          />
          {open ? (
            <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
              {loading ? (
                <p className="px-3 py-2 text-sm text-zinc-500">搜索中…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500">暂无匹配商品</p>
              ) : (
                items
                  .filter((i) => !value.includes(i.id))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="block w-full border-b border-zinc-50 px-3 py-2 text-left text-sm hover:bg-rose-50/50"
                      onClick={() => addProduct(item)}
                    >
                      {item.name}
                      <span className="ml-2 text-xs text-zinc-400">
                        {item.priceRange}
                      </span>
                    </button>
                  ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
