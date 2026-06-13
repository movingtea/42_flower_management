"use client";

import { useCallback, useEffect, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import type { RecipePickerItem } from "@/components/cms/pickers/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | null;
  onChange: (recipeId: string | null) => void;
};

export function RecipePickerDrawer({
  open,
  onOpenChange,
  value,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<RecipePickerItem[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(value);

  const fetchItems = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "40" });
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
    if (!open) return;
    deferEffectTask(() => {
      setPendingId(value);
      setQuery("");
      void fetchItems("");
    });
  }, [open, value, fetchItems]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void fetchItems(query), 280);
    return () => window.clearTimeout(timer);
  }, [open, query, fetchItems]);

  const selectedItem =
    items.find((item) => item.id === pendingId) ??
    (pendingId ? items.find((item) => item.id === value) : null);

  return (
    <AdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="选择配方"
      description="搜索并绑定标准配方"
      size="md"
      closeOnOverlayClick={false}
      bodyClassName="flex flex-col gap-3"
      footer={
        <DrawerFooterActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="绑定所选配方"
          confirmDisabled={!pendingId}
          onConfirm={() => {
            onChange(pendingId);
            onOpenChange(false);
          }}
        />
      }
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索配方名称、BOM 编号…"
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
      />

      {selectedItem ? (
        <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          已选：{selectedItem.bomNo} · {selectedItem.name}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">请从下方列表选择配方</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200">
        {loading ? (
          <p className="px-3 py-4 text-sm text-zinc-500">搜索中…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-sm text-zinc-500">暂无匹配配方</p>
        ) : (
          items.map((item) => {
            const active = pendingId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`block w-full border-b border-zinc-50 px-3 py-2.5 text-left last:border-b-0 ${
                  active ? "bg-rose-50" : "hover:bg-zinc-50"
                }`}
                onClick={() => setPendingId(item.id)}
              >
                <p className="text-sm font-medium text-zinc-900">{item.name}</p>
                <p className="text-xs text-zinc-500">
                  {item.bomNo}
                  {item.packagingKitName ? ` · ${item.packagingKitName}` : ""}
                  {item.estimatedCost ? ` · ¥${item.estimatedCost}` : ""}
                </p>
              </button>
            );
          })
        )}
      </div>
    </AdminDrawer>
  );
}
