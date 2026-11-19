"use client";
import { useMemo, useState } from "react";
import { input } from "../_components/V2Ui";
import { allocatePurchaseFees, type FeeAllocationMethod } from "./fee-allocation";

type MaterialOption = { id: string; label: string; unit: string };
type SupplierOption = { id: string; label: string };
type Line = { materialId: string; quantity: number; unitPrice: number };

const ALLOCATION_METHODS: { value: FeeAllocationMethod; label: string }[] = [
  { value: "BY_AMOUNT", label: "按金额分摊" },
  { value: "BY_QUANTITY", label: "按数量分摊" },
];

/**
 * Draft fields for a purchase order. The surrounding V2DrawerForm owns the
 * `<form>` element, the server action and the footer submit button, so this
 * component stays a pure client-side field group (lines and fee preview).
 */
export function PurchaseOrderEditor({ suppliers, materials, initial }: {
  suppliers: SupplierOption[]; materials: MaterialOption[];
  initial?: { purchaseOrderId: string; supplierId: string; expectedAt: string; freightCost: number; packagingCost: number; otherCost: number; notes: string; lines: Line[] };
}) {
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [{ materialId: materials[0]?.id ?? "", quantity: 1, unitPrice: 0 }]);
  const [fees, setFees] = useState({ freightCost: initial?.freightCost ?? 0, packagingCost: initial?.packagingCost ?? 0, otherCost: initial?.otherCost ?? 0 });
  const [allocationMethod, setAllocationMethod] = useState<FeeAllocationMethod>("BY_AMOUNT");
  const allocation = useMemo(() => allocatePurchaseFees(
    lines.map((line) => ({ quantity: Number(line.quantity) || 0, unitPrice: Number(line.unitPrice) || 0 })),
    fees,
    allocationMethod,
  ), [lines, fees, allocationMethod]);
  const subtotal = allocation.lineAmountTotal;
  const feeTotal = allocation.feeTotal;
  const allocatedTotal = allocation.lines.reduce((sum, line) => sum + line.allocatedFee, 0);
  const total = allocation.actualTotal;
  return <>
    {initial && <input type="hidden" name="purchaseOrderId" value={initial.purchaseOrderId} />}
    <input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">供应商<select className={`${input} mt-1`} name="supplierId" defaultValue={initial?.supplierId} required>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-sm">预计到货时间<input className={`${input} mt-1`} name="expectedAt" type="datetime-local" defaultValue={initial?.expectedAt} /></label></div>
    <div className="space-y-2">
      <div className="flex items-center justify-between"><h4 className="font-medium">采购明细</h4><button type="button" className="text-sm text-emerald-700" onClick={() => setLines((current) => [...current, { materialId: materials[0]?.id ?? "", quantity: 1, unitPrice: 0 }])}>＋ 添加明细</button></div>
      {lines.map((line, index) => {
        const preview = allocation.lines[index];
        return <div key={index} className="space-y-2 rounded-lg border border-zinc-200 p-3">
          <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
            <label className="block text-xs text-stone-600">物料<select className={`${input} mt-1`} value={line.materialId} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, materialId: event.target.value } : row))}>{materials.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.unit}</option>)}</select></label>
            <label className="block text-xs text-stone-600">采购数量<input className={`${input} mt-1`} type="number" min="0" step="0.001" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} aria-label="采购数量" /></label>
            <label className="block text-xs text-stone-600">采购单价（元）<input className={`${input} mt-1`} type="number" min="0" step="0.0001" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((row, i) => i === index ? { ...row, unitPrice: Number(event.target.value) } : row))} aria-label="采购单价" /></label>
            <button type="button" className="self-end text-sm text-red-700 disabled:text-zinc-300" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>删除</button>
          </div>
          <div className="grid gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-stone-600 sm:grid-cols-3">
            <span>分摊费用 <strong className="text-stone-900">¥{(preview?.allocatedFee ?? 0).toFixed(2)}</strong></span>
            <span>实际总成本 <strong className="text-stone-900">¥{(preview?.actualTotal ?? 0).toFixed(2)}</strong></span>
            <span>实际单位成本 <strong className="text-stone-900">¥{(preview?.actualUnitCost ?? 0).toFixed(4)}</strong></span>
          </div>
        </div>;
      })}
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3">
      <label className="block text-sm text-stone-700">费用分摊方式<select className={`${input} mt-1 w-48`} value={allocationMethod} onChange={(event) => setAllocationMethod(event.target.value as FeeAllocationMethod)}>{ALLOCATION_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <p className="max-w-md text-xs text-stone-500">分摊结果仅为编辑预览，便于比较每条明细的到货成本；最终成本以验收入库时确认的批次成本为准。</p>
    </div>
    <div className="grid gap-3 md:grid-cols-3">{(["freightCost", "packagingCost", "otherCost"] as const).map((key) => <label key={key} className="text-sm">{{ freightCost: "运费", packagingCost: "包装费", otherCost: "其他费用" }[key]}<input className={`${input} mt-1`} name={key} type="number" min="0" step="0.01" value={fees[key]} onChange={(event) => setFees((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div>
    <label className="block text-sm">采购备注<textarea className={`${input} mt-1 min-h-20`} name="notes" defaultValue={initial?.notes} /></label>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-50 px-4 py-3 text-sm">
      <span>明细小计 ¥{subtotal.toFixed(2)} ＋ 费用 ¥{feeTotal.toFixed(2)}（已分摊 ¥{allocatedTotal.toFixed(2)}）</span>
      <strong>实际总成本合计 ¥{total.toFixed(2)}</strong>
    </div>
    {(!suppliers.length || !materials.length) && (
      <p className="text-xs text-amber-800">创建采购单前需先启用供应商与物料。</p>
    )}
  </>;
}
