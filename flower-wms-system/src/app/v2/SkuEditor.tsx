"use client";

import { useState } from "react";
import { createSku } from "./actions";
import { materialPickerClass } from "./_components/material-option-label";

type Option = { id: string; label: string };

export function SkuEditor({ products, materials }: { products: Option[]; materials: Option[] }) {
  const [rows, setRows] = useState([{ id: 0, materialId: materials[0]?.id ?? "", quantity: "1" }]);
  const [nextId, setNextId] = useState(1);
  const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";
  return <form action={createSku} className="space-y-3"><h3 className="font-medium">添加 SKU 并发布配方</h3>
    <label className="block text-sm">所属商品<select className={`${input} mt-1`} name="productId" required>{products.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label className="block text-sm">SKU 名称<input className={`${input} mt-1`} name="name" required /></label>
    <p className="text-xs text-stone-500">SKU 编号由系统自动生成。</p>
    <label className="block text-sm">售价<input className={`${input} mt-1`} name="price" type="number" min="0" step="0.01" required /></label>
    <div className="grid grid-cols-2 gap-2"><label className="block text-sm">每件耗材估算<input className={`${input} mt-1`} name="estimatedConsumableCost" type="number" min="0" step="0.01" defaultValue="0" required /></label><label className="block text-sm">每件人工估算<input className={`${input} mt-1`} name="estimatedLaborCost" type="number" min="0" step="0.01" defaultValue="0" required /></label></div>
    <div><p className="text-sm font-medium">每件配方用料</p>{rows.map((row) => <div key={row.id} className="mt-2 flex gap-2">
      <select className={`${input} ${materialPickerClass}`} value={row.materialId} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, materialId: event.target.value } : item))}>{materials.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <input className={`${input} w-24 shrink-0`} aria-label="每件用量" type="number" min="0.001" step="0.001" value={row.quantity} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item))} />
      {rows.length > 1 && <button type="button" className="text-sm text-red-700" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>删除</button>}
    </div>)}</div>
    <input type="hidden" name="recipe" value={rows.map((row) => `${row.materialId},${row.quantity}`).join("\n")} />
    <button type="button" className="text-sm text-emerald-800 underline" onClick={() => { setRows((current) => [...current, { id: nextId, materialId: materials[0]?.id ?? "", quantity: "1" }]); setNextId(nextId + 1); }}>添加物料</button>
    <div><button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" disabled={!products.length || !materials.length}>发布 SKU</button></div>
  </form>;
}
