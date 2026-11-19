"use client";

import { useRef, useState } from "react";

type SkuOption = { id: string; label: string };
type OrderRow = { key: number; skuId: string; quantity: string };

const MAX_ROWS = 20;
const fieldClass = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";

/**
 * Compact multi-SKU rows for the manual-order form. Each row submits the parallel
 * itemSkuId/itemQuantity fields the createOrder action parses.
 */
export function MultiSkuOrderEditor({ skus }: { skus: SkuOption[] }) {
  const nextKey = useRef(2);
  const [rows, setRows] = useState<OrderRow[]>([
    { key: 1, skuId: skus[0]?.id ?? "", quantity: "1" },
  ]);

  const addRow = () => {
    setRows((current) => {
      if (current.length >= MAX_ROWS) return current;
      return [...current, { key: nextKey.current++, skuId: skus[0]?.id ?? "", quantity: "1" }];
    });
  };
  const removeRow = (key: number) => {
    setRows((current) => current.length <= 1
      ? current
      : current.filter((row) => row.key !== key));
  };
  const updateRow = (key: number, patch: Partial<OrderRow>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  };

  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-stone-700">商品行（{rows.length}/{MAX_ROWS}）</span>
      <button type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS}
        className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-900 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-400">
        添加商品行
      </button>
    </div>
    {rows.map((row, index) => <div key={row.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
      <label className="block text-sm text-stone-700">SKU {index + 1}
        <select className={`${fieldClass} mt-1`} name="itemSkuId" required value={row.skuId}
          onChange={(event) => updateRow(row.key, { skuId: event.target.value })}>
          {skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.label}</option>)}
        </select>
      </label>
      <label className="block text-sm text-stone-700">数量
        <input className={`${fieldClass} mt-1`} name="itemQuantity" type="number" min="1" step="1" required
          value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} />
      </label>
      <div className="flex items-end">
        <button type="button" onClick={() => removeRow(row.key)} disabled={rows.length <= 1}
          className="rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-700 disabled:cursor-not-allowed disabled:text-stone-400">
          移除
        </button>
      </div>
    </div>)}
    <p className="text-xs text-stone-500">同一订单可添加最多 20 个不同 SKU；保存后商品行不可增删或替换。</p>
  </div>;
}
