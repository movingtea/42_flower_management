"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import { Badge } from "@/components/ui/Badge";
import type { ProductPickerItem } from "@/components/cms/pickers/types";

type Props = {
  value: string | null;
  onChange: (productId: string | null, product?: ProductPickerItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
};

function productWarnings(item: ProductPickerItem): string[] {
  const warnings: string[] = [];
  if (item.status !== "active") {
    warnings.push("该商品未上架，小程序不会展示");
  }
  if (!item.coverImage) {
    warnings.push("该商品缺少主图，不建议放入推荐位");
  }
  if (item.skuCount === 0) {
    warnings.push("该商品缺少 SKU，不建议放入推荐位");
  }
  if (item.readinessStatus === "BLOCKED" || item.readinessStatus === "WARNING") {
    warnings.push("该商品上架校验未通过，请检查后再推荐");
  }
  if (
    item.productDecisionSummary.healthStatus === "HIGH_RISK" ||
    item.productDecisionSummary.healthStatus === "LOW_MARGIN"
  ) {
    warnings.push("该商品经营状态为高风险，不建议作为首页主推");
  }
  return warnings;
}

export function ProductPicker({
  value,
  onChange,
  placeholder = "输入商品名搜索…",
  disabled,
  label = "选择商品",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ProductPickerItem[]>([]);
  const [selected, setSelected] = useState<ProductPickerItem | null>(null);
  const [missing, setMissing] = useState(false);

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
      if (!value) {
        setSelected(null);
        setMissing(false);
        return;
      }
      if (selected?.id === value) return;

      void (async () => {
        try {
          const res = await fetch(
            `/api/admin/cms/products/search?keyword=${encodeURIComponent(value)}&limit=50`
          );
          const json = (await res.json()) as {
            success?: boolean;
            data?: { items?: ProductPickerItem[] };
          };
          if (cancelled) return;
          const hit = json.data?.items?.find((i) => i.id === value) ?? null;
          if (hit) {
            setSelected(hit);
            setMissing(false);
          } else {
            setSelected(null);
            setMissing(true);
          }
        } catch {
          if (!cancelled) setMissing(true);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
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

  const warnings = selected ? productWarnings(selected) : [];

  return (
    <div ref={rootRef} className="space-y-2">
      {label ? (
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
      ) : null}

      {selected ? (
        <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          {selected.coverImage ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-100">
              <Image
                src={selected.coverImage}
                alt=""
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-zinc-900">{selected.name}</p>
            <p className="text-xs text-zinc-500">
              {selected.categoryName ?? "未分类"} · {selected.priceRange}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {selected.status === "active" ? (
                <Badge variant="success">已上架</Badge>
              ) : (
                <Badge variant="warning">未上架</Badge>
              )}
            </div>
          </div>
          {!disabled ? (
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-red-600"
              onClick={() => {
                onChange(null, null);
                setSelected(null);
                setQuery("");
              }}
            >
              清除
            </button>
          ) : null}
        </div>
      ) : missing && value ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          关联对象不存在或已删除
        </p>
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
            placeholder={placeholder}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
          />
          {open ? (
            <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
              {loading ? (
                <p className="px-3 py-2 text-sm text-zinc-500">搜索中…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500">暂无匹配商品</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex w-full items-start gap-2 border-b border-zinc-50 px-3 py-2 text-left hover:bg-rose-50/50"
                    onClick={() => {
                      setSelected(item);
                      onChange(item.id, item);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    {item.coverImage ? (
                      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded">
                        <Image
                          src={item.coverImage}
                          alt=""
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900">
                        {item.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {item.categoryName ?? "未分类"} · {item.priceRange}
                        {item.status !== "active" ? " · 未上架" : ""}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="space-y-1 text-xs text-amber-700">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
