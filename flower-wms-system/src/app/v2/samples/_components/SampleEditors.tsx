"use client";

import { useMemo, useState } from "react";

export type MaterialOption = {
  id: string;
  code: string;
  name: string;
  kind: string;
  baseUnit: string;
  availableQty: number;
  standardUnitCost: number | null;
  active: boolean;
};

export type MaterialLine = { materialId: string; quantity: number };

const inputClass = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";

function materialLabel(material: MaterialOption): string {
  const stock = material.availableQty > 0 ? `可用 ${material.availableQty}${material.baseUnit}` : "无现货";
  const cost = material.standardUnitCost === null ? "未设成本" : `¥${material.standardUnitCost.toFixed(2)}/${material.baseUnit}`;
  return `${material.code} · ${material.name}${material.active ? "" : "（停用）"}（${stock}，${cost}）`;
}

export function MaterialLinesEditor({
  materials,
  initialLines,
  hiddenName = "materialsJson",
}: {
  materials: MaterialOption[];
  initialLines?: MaterialLine[];
  hiddenName?: string;
}) {
  const [lines, setLines] = useState<MaterialLine[]>(
    initialLines && initialLines.length > 0
      ? initialLines
      : [{ materialId: materials[0]?.id ?? "", quantity: 1 }],
  );

  const availableById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials],
  );

  const update = (index: number, patch: Partial<MaterialLine>) => {
    setLines((current) => current.map((line, row) => row === index ? { ...line, ...patch } : line));
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name={hiddenName} value={JSON.stringify(lines)} />
      {lines.map((line, index) => {
        const selected = availableById.get(line.materialId);
        return (
          <div key={`${index}-${line.materialId}`} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-[1fr_7rem_auto]">
            <label className="text-xs text-stone-600">
              物料
              <select
                className={`${inputClass} mt-1`}
                value={line.materialId}
                onChange={(event) => update(index, { materialId: event.target.value })}
              >
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {materialLabel(material)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-600">
              用量{selected ? `（${selected.baseUnit}）` : ""}
              <input
                className={`${inputClass} mt-1`}
                type="number"
                min="0.001"
                step="0.001"
                value={line.quantity}
                onChange={(event) => update(index, { quantity: Number(event.target.value) })}
              />
            </label>
            <button
              type="button"
              className="self-end rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-600"
              onClick={() => setLines((current) => current.length === 1
                ? current
                : current.filter((_, row) => row !== index))}
            >
              删除
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
        onClick={() => setLines((current) => [
          ...current,
          { materialId: materials[0]?.id ?? "", quantity: 1 },
        ])}
        disabled={materials.length === 0}
      >
        + 添加物料
      </button>
      <p className="text-xs text-stone-500">
        现货数量与标准成本仅用于推荐和测算，不会自动替换人工选择。样品完成后才可转为 SKU。
      </p>
    </div>
  );
}

export type SampleOption = {
  id: string;
  code: string;
  name: string;
  state: string;
  materialCount: number;
  priority: number;
};

export type PlanItem = {
  sampleId: string;
  quantity: number;
  mandatory: boolean;
  sequenceNo: number;
};

export function SamplePlanItemsEditor({
  samples,
  initialItems,
}: {
  samples: SampleOption[];
  initialItems?: PlanItem[];
}) {
  const [items, setItems] = useState<PlanItem[]>(
    initialItems && initialItems.length > 0
      ? initialItems
      : samples[0]
        ? [{ sampleId: samples[0].id, quantity: 1, mandatory: true, sequenceNo: 1 }]
        : [],
  );

  const update = (index: number, patch: Partial<PlanItem>) => {
    setItems((current) => current.map((item, row) => row === index ? { ...item, ...patch } : item));
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name="itemsJson" value={JSON.stringify(items)} />
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          还没有可选样品。请先在样品库建立花材搭配。
        </p>
      )}
      {items.map((item, index) => (
        <div key={`${index}-${item.sampleId}`} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-[1fr_5rem_5rem_auto_auto]">
          <label className="text-xs text-stone-600">
            样品
            <select
              className={`${inputClass} mt-1`}
              value={item.sampleId}
              onChange={(event) => update(index, { sampleId: event.target.value })}
            >
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.code} · {sample.name}（{sample.materialCount} 项物料）
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-stone-600">
            数量
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min="1"
              step="1"
              value={item.quantity}
              onChange={(event) => update(index, { quantity: Number(event.target.value) })}
            />
          </label>
          <label className="text-xs text-stone-600">
            顺序
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min="1"
              step="1"
              value={item.sequenceNo}
              onChange={(event) => update(index, { sequenceNo: Number(event.target.value) })}
            />
          </label>
          <label className="flex items-end gap-1 pb-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={item.mandatory}
              onChange={(event) => update(index, { mandatory: event.target.checked })}
            />
            必选
          </label>
          <button
            type="button"
            className="self-end rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-600"
            onClick={() => setItems((current) => current.filter((_, row) => row !== index))}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"
        onClick={() => setItems((current) => [
          ...current,
          {
            sampleId: samples[0]?.id ?? "",
            quantity: 1,
            mandatory: current.length === 0,
            sequenceNo: current.length + 1,
          },
        ])}
        disabled={samples.length === 0}
      >
        + 添加样品
      </button>
      <p className="text-xs text-stone-500">
        只选择一个必选样品时，计算会从其余已完成样品中推荐搭配；多个必选样品按顺序制作。拆解后的复用数量在每步完成后按实际确认。
      </p>
    </div>
  );
}

export type StepMaterialInput = {
  materialId: string;
  name: string;
  baseUnit: string;
  inputQty: number;
  reusedQty: number;
};

export function StepActualsEditor({
  materials,
  defaultDisassemble,
}: {
  materials: StepMaterialInput[];
  defaultDisassemble: boolean;
}) {
  const [lines, setLines] = useState(() => materials.map((material) => ({
    materialId: material.materialId,
    usedQty: material.inputQty,
    reusableQty: 0,
  })));
  const [disassemble, setDisassemble] = useState(defaultDisassemble);

  return (
    <div className="space-y-3">
      <input type="hidden" name="actualsJson" value={JSON.stringify(lines)} />
      <input type="hidden" name="disassemble" value={String(disassemble)} />
      <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={disassemble}
          onChange={(event) => {
            const checked = event.target.checked;
            setDisassemble(checked);
            if (!checked) {
              setLines((current) => current.map((line) => ({ ...line, reusableQty: 0 })));
            }
          }}
        />
        本步完成后拆解样品，登记可复用花材（不拆解则样品保留）
      </label>
      {materials.map((material, index) => (
        <div key={material.materialId} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-[1fr_8rem_8rem]">
          <div className="text-sm">
            <div className="font-medium">{material.name}</div>
            <div className="text-xs text-stone-500">
              本步投入 {material.inputQty}{material.baseUnit}（其中复用 {material.reusedQty}{material.baseUnit}）
            </div>
          </div>
          <label className="text-xs text-stone-600">
            实际用量
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min="0"
              max={material.inputQty}
              step="0.001"
              value={lines[index]?.usedQty ?? 0}
              onChange={(event) => setLines((current) => current.map((line, row) =>
                row === index ? { ...line, usedQty: Number(event.target.value) } : line))}
            />
          </label>
          <label className="text-xs text-stone-600">
            拆解可复用
            <input
              className={`${inputClass} mt-1`}
              type="number"
              min="0"
              max={lines[index]?.usedQty ?? 0}
              step="0.001"
              disabled={!disassemble}
              value={lines[index]?.reusableQty ?? 0}
              onChange={(event) => setLines((current) => current.map((line, row) =>
                row === index ? { ...line, reusableQty: Number(event.target.value) } : line))}
            />
          </label>
        </div>
      ))}
      <p className="text-xs text-stone-500">
        未拆解时，实际用量进入保留样品；拆解时，实际用量减去可复用量后计为损耗。未使用部分留在制作区，不计入普通可售库存。
      </p>
    </div>
  );
}
