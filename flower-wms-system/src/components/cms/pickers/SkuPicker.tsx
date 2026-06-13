"use client";

import { useEffect, useState } from "react";
import { deferEffectTask } from "@/lib/defer-effect";
import type { ProductSkuPickerItem } from "@/components/cms/pickers/types";

type Props = {
  productId: string | null;
  value: string | null;
  onChange: (skuId: string | null) => void;
  disabled?: boolean;
  label?: string;
};

export function SkuPicker({
  productId,
  value,
  onChange,
  disabled,
  label = "选择 SKU",
}: Props) {
  const [items, setItems] = useState<ProductSkuPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    deferEffectTask(() => {
      if (cancelled) return;
      if (!productId) {
        setItems([]);
        return;
      }

      setLoading(true);
      setError("");

      void (async () => {
        try {
          const res = await fetch(`/api/admin/cms/products/${productId}/skus`);
          const json = (await res.json()) as {
            success?: boolean;
            error?: string;
            data?: { items?: ProductSkuPickerItem[] };
          };
          if (!res.ok || !json.success) {
            throw new Error(json.error ?? "SKU 加载失败");
          }
          if (!cancelled) {
            setItems(json.data?.items ?? []);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "SKU 加载失败");
            setItems([]);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!productId) {
    return (
      <p className="text-sm text-zinc-500">请先选择商品，再选择 SKU</p>
    );
  }

  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2"
      >
        <option value="">
          {loading ? "加载 SKU 中…" : "不指定 SKU（使用商品默认规格）"}
        </option>
        {items.map((sku) => (
          <option key={sku.id} value={sku.id}>
            {sku.name} · ¥{sku.price}
            {sku.recipeName ? ` · 配方：${sku.recipeName}` : " · 未绑配方"}
            {sku.marginSummary ? ` · ${sku.marginSummary}` : ""}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {items.length === 0 && !loading ? (
        <p className="text-xs text-amber-700">该商品暂无 SKU</p>
      ) : null}
    </label>
  );
}
