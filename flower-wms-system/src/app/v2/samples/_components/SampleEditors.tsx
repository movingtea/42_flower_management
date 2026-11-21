"use client";

import { useMemo, useState } from "react";
import {
  duplicateMaterialNames,
  materialOptionLabel,
  materialPickerClass,
} from "../../_components/material-option-label";
import { sampleDisplayName } from "../../_lib/sample-display";

export type MaterialOption = {
  id: string;
  code: string;
  name: string;
  kind: string;
  baseUnit: string;
  availableQty: number;
  standardUnitCost: number | null;
  active: boolean;
  /** Flower three-level classification: 种类. Optional for non-flower materials. */
  flowerVariety?: string | null;
  /** Flower product name (商品名). */
  flowerProductName?: string | null;
  /** Flower color (颜色), reusing Material.color. */
  color?: string | null;
};

export type MaterialLine = { materialId: string; quantity: number };

const inputClass = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";

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

  const duplicateNames = useMemo(() => duplicateMaterialNames(materials), [materials]);

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
                className={`${inputClass} ${materialPickerClass} mt-1`}
                value={line.materialId}
                onChange={(event) => update(index, { materialId: event.target.value })}
              >
                {materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {materialOptionLabel(material, duplicateNames)}
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

export type SampleClassificationSummary = {
  flowerVariety: string | null;
  flowerProductName: string | null;
  color: string | null;
};

export type SampleRecipeItem = {
  materialId: string;
  name: string;
  /** `MaterialKind`; used only to pick the flower/foliage icon in the preview. */
  kind: string;
  baseUnit: string;
  quantity: number;
};

export type SampleOption = {
  id: string;
  code: string;
  name: string;
  state: string;
  materialCount: number;
  priority: number;
  /** Full recipe, used by the sample-plan creation drawer's recipe preview. */
  recipe?: SampleRecipeItem[];
  /** Classifications of this sample's flower materials, used for recommendation hints only. */
  classifications?: SampleClassificationSummary[];
};

function classificationLabel(classification: SampleClassificationSummary): string | null {
  const variety = classification.flowerVariety?.trim() ?? "";
  const color = classification.color?.trim() ?? "";
  if (!variety || !color) return null;
  const productName = classification.flowerProductName?.trim() ?? "";
  return productName ? `${variety} / ${color} / ${productName}` : `${variety} / ${color}`;
}

function sampleClassificationSummary(sample: SampleOption): string {
  const labels = [...new Set(
    (sample.classifications ?? [])
      .map(classificationLabel)
      .filter((label): label is string => Boolean(label)),
  )];
  return labels.slice(0, 2).join("、");
}

type ReuseSuggestion = {
  key: string;
  tier: "exact" | "varietyColor";
  variety: string;
  productName: string | null;
  color: string;
  sampleNames: string[];
};

/**
 * Cross-sample classification hints for the plan editor. Only samples that are
 * currently included in the plan are compared. A shared 种类+颜色 pair is the
 * grouping key; the group is "exact" only when every involved sample also has
 * the same non-empty 商品名.
 */
function buildReuseSuggestions(items: PlanItem[], samples: SampleOption[]): ReuseSuggestion[] {
  const optionById = new Map(samples.map((sample) => [sample.id, sample]));
  const groups = new Map<string, {
    variety: string;
    color: string;
    entries: { name: string; productName: string | null }[];
  }>();
  for (const item of items) {
    const sample = optionById.get(item.sampleId);
    if (!sample) continue;
    const seen = new Set<string>();
    for (const classification of sample.classifications ?? []) {
      const variety = classification.flowerVariety?.trim() ?? "";
      const color = classification.color?.trim() ?? "";
      const productName = classification.flowerProductName?.trim() || null;
      if (!variety || !color) continue;
      const key = `${variety}|${color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) ?? { variety, color, entries: [] };
      group.entries.push({ name: sample.name, productName });
      groups.set(key, group);
    }
  }

  const suggestions: ReuseSuggestion[] = [];
  for (const [key, group] of groups) {
    const sampleNames = [...new Set(group.entries.map((entry) => entry.name))];
    if (sampleNames.length < 2) continue;
    const products = new Set(
      group.entries
        .map((entry) => entry.productName)
        .filter((value): value is string => Boolean(value)),
    );
    const exact = group.entries.every((entry) => Boolean(entry.productName)) && products.size === 1;
    suggestions.push({
      key,
      tier: exact ? "exact" : "varietyColor",
      variety: group.variety,
      productName: exact ? [...products][0] ?? null : null,
      color: group.color,
      sampleNames,
    });
  }
  return suggestions.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier === "exact" ? -1 : 1;
    return left.variety.localeCompare(right.variety) || left.color.localeCompare(right.color);
  });
}

export type PlanItem = {
  sampleId: string;
  quantity: number;
  mandatory: boolean;
  sequenceNo: number;
  /** Photography deadline (datetime-local value) for this plan item. */
  photoDueAt?: string | null;
  /** Retention deadline (datetime-local value) for this plan item. */
  retentionUntil?: string | null;
  /** Batch-2 auto ordering may reorder this item by photo/retention dates. */
  autoSchedule?: boolean;
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
        ? [{ sampleId: samples[0].id, quantity: 1, mandatory: true, sequenceNo: 1 }]        : [],
  );

  const update = (index: number, patch: Partial<PlanItem>) => {
    setItems((current) => current.map((item, row) => row === index ? { ...item, ...patch } : item));
  };

  const reuseSuggestions = useMemo(() => buildReuseSuggestions(items, samples), [items, samples]);

  return (
    <div className="space-y-2">
      <input type="hidden" name="itemsJson" value={JSON.stringify(items)} />
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          还没有可选样品。请先在样品库建立花材搭配。
        </p>
      )}
      {items.map((item, index) => (
        <div key={`${index}-${item.sampleId}`} className="rounded-lg border border-stone-200 bg-white p-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem_auto_auto]">
            <label className="text-xs text-stone-600">
              样品
              <select
                className={`${inputClass} mt-1`}
                value={item.sampleId}
                onChange={(event) => update(index, { sampleId: event.target.value })}
              >
                {samples.map((sample) => {
                  const summary = sampleClassificationSummary(sample);
                  return (
                    <option key={sample.id} value={sample.id}>
                      {sampleDisplayName(sample)} · {sample.materialCount} 项物料{summary ? ` · ${summary}` : ""}
                    </option>
                  );
                })}
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
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="text-xs text-stone-600">
              拍摄截止
              <input
                className={`${inputClass} mt-1`}
                type="datetime-local"
                value={item.photoDueAt ?? ""}
                onChange={(event) => update(index, { photoDueAt: event.target.value || null })}
              />
            </label>
            <label className="text-xs text-stone-600">
              留样截止
              <input
                className={`${inputClass} mt-1`}
                type="datetime-local"
                value={item.retentionUntil ?? ""}
                onChange={(event) => update(index, { retentionUntil: event.target.value || null })}
              />
            </label>
            <label className="flex items-end gap-1 pb-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={item.autoSchedule !== false}
                onChange={(event) => update(index, { autoSchedule: event.target.checked })}
              />
              自动排程（全部开启时生效）
            </label>
          </div>
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
            autoSchedule: true,
          },
        ])}
        disabled={samples.length === 0}
      >
        + 添加样品
      </button>
      {reuseSuggestions.length > 0 && (
        <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p className="font-medium">可复用花材建议（按种类 / 颜色 / 商品名）</p>
          {reuseSuggestions.map((suggestion) => (
            <p key={suggestion.key}>
              {suggestion.tier === "exact"
                ? "三级全同"
                : "种类 + 颜色相同（商品名不同或缺失）"}
              ：{suggestion.variety}
              {" / "}
              {suggestion.color}
              {suggestion.productName ? ` / ${suggestion.productName}` : ""}
              <span className="text-emerald-800"> · {suggestion.sampleNames.join("、")}</span>
            </p>
          ))}
          <p className="text-emerald-800">
            仅为分类搭配提示，不代表已确认复用，也不改变实际复用数量、成本与预留；实际复用以同一物料拆解后重新验收确认的可用量为准。
          </p>
        </div>
      )}
      <p className="text-xs text-stone-500">
        编辑历史计划时可保留多个必选（主）样品；新建计划使用单个主样品并在创建抽屉中获取搭配推荐。填写拍摄/留样截止后，开启自动排程会先安排拍摄早的样品，并把留样样品放在末步，避免拆解掉需要保留的样品。
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
