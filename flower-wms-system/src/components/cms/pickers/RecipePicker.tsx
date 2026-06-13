"use client";

import { useCallback, useEffect, useState } from "react";
import { deferEffectTask, useDeferredEffect } from "@/lib/defer-effect";
import { RecipePickerDrawer } from "@/components/cms/pickers/RecipePickerDrawer";
import { Button } from "@/components/ui/button";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
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
            `/api/admin/wms/recipes/search?keyword=${encodeURIComponent(value)}&limit=50`
          );
          const json = (await res.json()) as {
            data?: { items?: RecipePickerItem[] };
          };
          if (cancelled) return;
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
            if (cancelled) return;
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
          if (!cancelled) setMissing(true);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [value, selected?.id]);

  useDeferredEffect(() => {
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
    <div className="space-y-2">
      {label ? (
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
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-7 px-2 text-xs"
                onClick={() => setDrawerOpen(true)}
              >
                更换配方
              </Button>
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-red-600"
                onClick={() => {
                  onChange(null);
                  setSelected(null);
                }}
              >
                清除绑定
              </button>
            </div>
          ) : null}
        </div>
      ) : missing && value ? (
        <p className="text-sm text-amber-700">关联对象不存在或已删除</p>
      ) : !disabled ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setDrawerOpen(true)}
        >
          选择配方
        </Button>
      ) : null}

      {!disabled ? (
        <RecipePickerDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          value={value}
          onChange={(recipeId) => {
            onChange(recipeId);
            if (recipeId) {
              void fetchItems("").then(() => {
                /* selected sync via value effect */
              });
            } else {
              setSelected(null);
            }
          }}
        />
      ) : null}

      <p className="text-xs text-zinc-500">
        配方在 WMS「标准配方研发中心」维护，单号由系统自动分配
      </p>
    </div>
  );
}
