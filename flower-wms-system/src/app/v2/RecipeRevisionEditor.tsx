"use client";

import { useState } from "react";
import { reviseSkuRecipe } from "./actions";
import { materialPickerClass } from "./_components/material-option-label";

type Sku = { id: string; label: string; ingredients: { materialId: string; quantity: string }[] };
type Material = { id: string; label: string };

export function RecipeRevisionEditor({ skus, materials }: { skus: Sku[]; materials: Material[] }) {
  const [skuId, setSkuId] = useState(skus[0]?.id ?? "");
  const [rows, setRows] = useState(skus[0]?.ingredients ?? []);
  const selected = skus.find((sku) => sku.id === skuId);
  const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";
  return <form action={reviseSkuRecipe} className="space-y-3">
    <h3 className="font-medium">发布新配方版本</h3>
    <select className={input} name="skuId" value={skuId} onChange={(event) => { const next = skus.find((sku) => sku.id === event.target.value); setSkuId(event.target.value); setRows(next?.ingredients ?? []); }}>
      {skus.map((sku) => <option key={sku.id} value={sku.id}>{sku.label}</option>)}
    </select>
    <p className="text-xs text-stone-500">调整后生成新版本；既有订单继续引用原版本。</p>
    {rows.map((row, index) => <div key={`${skuId}-${index}`} className="flex gap-2">
      <select className={`${input} ${materialPickerClass}`} value={row.materialId} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, materialId: event.target.value } : item))}>{materials.map((material) => <option key={material.id} value={material.id}>{material.label}</option>)}</select>
      <input className={`${input} w-24 shrink-0`} type="number" min="0.001" step="0.001" aria-label="每件用量" value={row.quantity} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} />
      <button type="button" className="text-sm text-red-700" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>删除</button>
    </div>)}
    <input type="hidden" name="recipe" value={rows.map((row) => `${row.materialId},${row.quantity}`).join("\n")} />
    <div className="flex gap-3"><button type="button" className="text-sm text-emerald-800 underline" onClick={() => setRows((current) => [...current, { materialId: materials[0]?.id ?? "", quantity: "1" }])}>添加物料</button><button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white" disabled={!selected || !rows.length}>发布新版本</button></div>
  </form>;
}
