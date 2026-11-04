"use client";

import { Check, Flower2, Leaf, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveMaterial, saveSample } from "@/app/actions";
import type { MaterialInput, SampleInput } from "@/lib/types";
import { NumericInput } from "@/components/numeric-input";

export type EditorTarget = { type: "sample"; item?: SampleInput } | { type: "material"; item?: MaterialInput };

export function EditorModal({ target, materials, onClose }: { target: EditorTarget; materials: MaterialInput[]; onClose: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(action: () => ReturnType<typeof saveSample> | ReturnType<typeof saveMaterial>) {
    setSaving(true); setError("");
    const result = await action();
    setSaving(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
    onClose();
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" onMouseDown={(event) => event.stopPropagation()}>
      {target.type === "sample"
        ? <SampleEditor item={target.item} materials={materials} saving={saving} error={error} onClose={onClose} onSave={(payload) => submit(() => saveSample(payload))} />
        : <MaterialEditor item={target.item} saving={saving} error={error} onClose={onClose} onSave={(payload) => submit(() => saveMaterial(payload))} />}
    </section>
  </div>;
}

function SampleEditor({ item, materials, saving, error, onClose, onSave }: { item?: SampleInput; materials: MaterialInput[]; saving: boolean; error: string; onClose: () => void; onSave: (payload: Parameters<typeof saveSample>[0]) => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? "");
  const [priority, setPriority] = useState(item?.priority ?? 2);
  const [color, setColor] = useState(item?.color ?? "#d8c9d8");
  const [rows, setRows] = useState(() => item?.materials.map((row) => ({ materialId: row.material.id, quantity: row.quantity })) ?? [{ materialId: materials[0]?.id ?? 0, quantity: 1 }]);
  const availableToAdd = materials.filter((material) => !rows.some((row) => row.materialId === material.id));

  return <form onSubmit={(event) => { event.preventDefault(); onSave({ id: item?.id, name, subtitle, priority, color, materials: rows }); }}>
    <EditorHeading icon={<Flower2 />} title={item ? "编辑样品" : "新建样品"} subtitle="维护样品信息及制作所需花材" onClose={onClose} />
    <div className="form-grid"><Field label="样品名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：春日花篮" maxLength={60} required /></Field><Field label="推广优先级"><select value={priority} onChange={(event) => setPriority(Number(event.target.value))}><option value={3}>高</option><option value={2}>中</option><option value={1}>低</option></select></Field></div>
    <Field label="样品说明"><input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="简要描述风格和推广用途" maxLength={120} required /></Field>
    <Field label="识别颜色"><div className="color-field"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span>{color}</span></div></Field>
    <div className="editor-section-title"><div><strong>所需花材</strong><small>数量必须大于 0</small></div>{availableToAdd.length > 0 && <button type="button" onClick={() => setRows([...rows, { materialId: availableToAdd[0].id, quantity: 1 }])}><Plus size={14} />添加花材</button>}</div>
    <div className="material-rows">{rows.map((row, index) => <div key={`${row.materialId}-${index}`}><select value={row.materialId} onChange={(event) => setRows(rows.map((candidate, rowIndex) => rowIndex === index ? { ...candidate, materialId: Number(event.target.value) } : candidate))}>{materials.map((material) => <option disabled={rows.some((candidate, rowIndex) => rowIndex !== index && candidate.materialId === material.id)} key={material.id} value={material.id}>{material.name} · {material.category}</option>)}</select><label><NumericInput min={1} max={999} value={row.quantity} aria-label={`${materials.find((material) => material.id === row.materialId)?.name ?? "花材"}数量`} onValueChange={(quantity) => setRows(rows.map((candidate, rowIndex) => rowIndex === index ? { ...candidate, quantity } : candidate))} /><span>{materials.find((material) => material.id === row.materialId)?.unit ?? "枝"}</span></label><button type="button" aria-label="移除花材" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button></div>)}</div>
    <EditorFooter saving={saving} error={error} onClose={onClose} />
  </form>;
}

function MaterialEditor({ item, saving, error, onClose, onSave }: { item?: MaterialInput; saving: boolean; error: string; onClose: () => void; onSave: (payload: Parameters<typeof saveMaterial>[0]) => void }) {
  const [name, setName] = useState(item?.name ?? ""); const [category, setCategory] = useState(item?.category ?? "主花"); const [unit, setUnit] = useState(item?.unit ?? "枝"); const [unitPrice, setUnitPrice] = useState(item?.unitPrice ?? 0); const [lossPercent, setLossPercent] = useState(Math.round((item?.lossRate ?? .1) * 100)); const [color, setColor] = useState(item?.color ?? "#7b9b80");
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ id: item?.id, name, category, unit, unitPrice, lossRate: lossPercent / 100, color }); }}>
    <EditorHeading icon={<Leaf />} title={item ? "编辑花材" : "新增花材"} subtitle="价格与拆解损耗将参与方案计算" onClose={onClose} />
    <div className="form-grid"><Field label="花材名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：香槟玫瑰" required /></Field><Field label="分类"><select value={category} onChange={(event) => setCategory(event.target.value)}><option>主花</option><option>配花</option><option>叶材</option><option>线条花</option><option>其他</option></select></Field></div>
    <div className="form-grid three"><Field label="采购单价"><NumericInput min={0} max={999999} decimals={2} value={unitPrice} onValueChange={setUnitPrice} required /></Field><Field label="计量单位"><input value={unit} maxLength={10} onChange={(event) => setUnit(event.target.value)} required /></Field><Field label="拆解损耗"><label className="suffix-input"><NumericInput min={0} max={90} value={lossPercent} onValueChange={setLossPercent} /><span>%</span></label></Field></div>
    <Field label="识别颜色"><div className="color-field"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /><span>{color}</span></div></Field>
    <EditorFooter saving={saving} error={error} onClose={onClose} />
  </form>;
}

function EditorHeading({ icon, title, subtitle, onClose }: { icon: React.ReactNode; title: string; subtitle: string; onClose: () => void }) { return <div className="modal-heading editor-heading"><div><span>{icon}</span><div><h2 id="editor-title">{title}</h2><p>{subtitle}</p></div></div><button type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="editor-field"><span>{label}</span>{children}</label>; }
function EditorFooter({ saving, error, onClose }: { saving: boolean; error: string; onClose: () => void }) { return <><div className="form-error" role="alert">{error}</div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "保存中" : "保存"}</button></div></>; }
