"use client";
import { useMemo, useState } from "react";
import { button, input } from "../_components/V2Ui";

type MaterialOption = { id: string; label: string; unit: string };
type SupplierOption = { id: string; label: string };
type Line = { materialId: string; quantity: number; unitPrice: number };

export function PurchaseOrderEditor({ action, suppliers, materials, initial }: {
  action: (data: FormData) => void | Promise<void>; suppliers: SupplierOption[]; materials: MaterialOption[];
  initial?: { purchaseOrderId: string; supplierId: string; expectedAt: string; freightCost: number; packagingCost: number; otherCost: number; notes: string; lines: Line[] };
}) {
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [{ materialId: materials[0]?.id ?? "", quantity: 1, unitPrice: 0 }]);
  const [fees, setFees] = useState({ freightCost: initial?.freightCost ?? 0, packagingCost: initial?.packagingCost ?? 0, otherCost: initial?.otherCost ?? 0 });
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitPrice || 0), 0), [lines]);
  const total = subtotal + fees.freightCost + fees.packagingCost + fees.otherCost;
  return <form action={action} className="space-y-4">
    {initial && <input type="hidden" name="purchaseOrderId" value={initial.purchaseOrderId} />}
    <input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">供应商<select className={`${input} mt-1`} name="supplierId" defaultValue={initial?.supplierId} required>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-sm">预计到货时间<input className={`${input} mt-1`} name="expectedAt" type="datetime-local" defaultValue={initial?.expectedAt} /></label></div>
    <div className="space-y-2"><div className="flex items-center justify-between"><h4 className="font-medium">采购明细</h4><button type="button" className="text-sm text-emerald-700" onClick={() => setLines((current) => [...current, { materialId: materials[0]?.id ?? "", quantity: 1, unitPrice: 0 }])}>＋ 添加明细</button></div>{lines.map((line, index) => <div key={index} className="grid gap-2 rounded-lg border border-zinc-200 p-3 md:grid-cols-[2fr_1fr_1fr_auto]"><select className={input} value={line.materialId} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, materialId: event.target.value } : row))}>{materials.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.unit}</option>)}</select><input className={input} type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} aria-label="采购数量" /><input className={input} type="number" min="0" step="0.0001" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, unitPrice: Number(event.target.value) } : row))} aria-label="采购单价" /><button type="button" className="text-sm text-red-700 disabled:text-zinc-300" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>删除</button></div>)}</div>
    <div className="grid gap-3 md:grid-cols-3">{(["freightCost", "packagingCost", "otherCost"] as const).map((key) => <label key={key} className="text-sm">{{ freightCost: "运费", packagingCost: "包装费", otherCost: "其他费用" }[key]}<input className={`${input} mt-1`} name={key} type="number" min="0" step="0.01" value={fees[key]} onChange={(event) => setFees((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div>
    <label className="block text-sm">采购备注<textarea className={`${input} mt-1 min-h-20`} name="notes" defaultValue={initial?.notes} /></label>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-50 px-4 py-3 text-sm"><span>明细小计 ¥{subtotal.toFixed(2)} ＋ 费用 ¥{(total - subtotal).toFixed(2)}</span><strong>预计总额 ¥{total.toFixed(2)}</strong></div>
    <button className={button} disabled={!suppliers.length || !materials.length}>{initial ? "保存草稿" : "创建采购草稿"}</button>
  </form>;
}
