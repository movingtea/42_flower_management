"use client";

import { useState, type MouseEvent } from "react";
import { WikiCareTable } from "@/components/wiki/WikiCareTable";
import {
  careTableToMaintenanceText,
  emptyCareTable,
  normalizeCareTable,
  parseStoredCareDocument,
  validateCareTableForSave,
  type WikiCareRow,
} from "@/lib/wiki-care";

export type MaterialCategoryOption = {
  id: string;
  name: string;
  active: boolean;
};

export type MaterialKnowledgeEditorValue = {
  englishName: string | null;
  flowerLanguage: string | null;
  maintenance: string | null;
  maintenanceCare: unknown;
  supplySeason: string | null;
  defaultShelfLifeDays: number | null;
  standardUnitCost: string | null;
  costUnit: string | null;
  costNote: string | null;
  optimisticUsableRate: string | null;
  standardUsableRate: string | null;
  conservativeUsableRate: string | null;
  lossRateNote: string | null;
  brand: string | null;
  model: string | null;
  notes: string | null;
  safetyStockThreshold: string | null;
  categoryIds: string[];
};

type Props = {
  material?: MaterialKnowledgeEditorValue;
  categories: MaterialCategoryOption[];
};

type CareMode = "table" | "text";
type Feedback = { tone: "success" | "error"; message: string };

type AiResponse = {
  success?: boolean;
  error?: string;
  data?: {
    combinedEnglishName?: string;
    latinName?: string;
    englishName?: string;
    flowerLanguage?: string;
    careTable?: WikiCareRow[];
  };
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
const textareaClass = `${inputClass} min-h-20`;
const sectionClass = "rounded-xl border border-zinc-200 bg-zinc-50/60 p-3";

/** Stored rates are 0–1; the form edits them as 0–100 percentages. */
function rateToPercent(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return String(Number((parsed * 100).toFixed(4)));
}

export function MaterialKnowledgeEditor({ material, categories }: Props) {
  const [englishName, setEnglishName] = useState(material?.englishName ?? "");
  const [flowerLanguage, setFlowerLanguage] = useState(
    material?.flowerLanguage ?? "",
  );
  const [maintenance, setMaintenance] = useState(material?.maintenance ?? "");
  const [careRows, setCareRows] = useState<WikiCareRow[]>(() => {
    const stored = parseStoredCareDocument(material?.maintenanceCare);
    return stored && validateCareTableForSave(stored) ? stored : emptyCareTable();
  });
  const [careMode, setCareMode] = useState<CareMode>(() => {
    const stored = parseStoredCareDocument(material?.maintenanceCare);
    return stored && validateCareTableForSave(stored) ? "table" : "text";
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  function showFeedback(tone: Feedback["tone"], message: string) {
    setFeedback({ tone, message });
  }

  function switchToTable() {
    setCareMode("table");
    setFeedback(null);
  }

  function switchToText() {
    const derived = careTableToMaintenanceText(careRows).trim();
    if (derived) setMaintenance(derived);
    setCareMode("text");
    setFeedback(null);
  }

  async function handleAiComplete(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const flowerName =
      form?.querySelector<HTMLInputElement>('input[name="name"]')?.value.trim() ??
      "";

    if (!flowerName) {
      showFeedback("error", "请先填写物料名称（中文常用名）");
      return;
    }

    setAiLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/v2/ai/complete-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowerName }),
      });
      let json: AiResponse | null = null;
      try {
        json = (await response.json()) as AiResponse;
      } catch {
        json = null;
      }
      if (!response.ok || !json?.success || !json.data) {
        throw new Error(
          json?.error ?? `AI 补全失败（HTTP ${response.status}）`,
        );
      }

      const data = json.data;
      const combined =
        data.combinedEnglishName ||
        [data.latinName, data.englishName].filter(Boolean).join(" / ");
      if (combined) setEnglishName(combined);
      if (data.flowerLanguage) setFlowerLanguage(data.flowerLanguage);
      if (data.careTable?.length) {
        const normalized = normalizeCareTable(data.careTable);
        setCareRows(normalized);
        setCareMode("table");
        setMaintenance(careTableToMaintenanceText(normalized));
      }
      showFeedback("success", "AI 智能补全成功，请核对内容后保存");
    } catch (cause) {
      showFeedback(
        "error",
        cause instanceof Error ? cause.message : "AI 补全失败",
      );
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 text-sm text-zinc-700">
          拉丁学名 / 英文名
          <input
            className={`${inputClass} mt-1`}
            name="englishName"
            value={englishName}
            onChange={(event) => setEnglishName(event.target.value)}
            placeholder="如 Rosa hybrida / Rose，可由 AI 补全"
          />
        </label>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={(event) => void handleAiComplete(event)}
          disabled={aiLoading}
        >
          {aiLoading ? "AI 补全中…" : "✨ AI 一键智能补全"}
        </button>
      </div>
      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${
            feedback.tone === "error"
              ? "bg-red-50 text-red-800"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <label className="block text-sm text-zinc-700">
        花语
        <textarea
          className={textareaClass}
          name="flowerLanguage"
          value={flowerLanguage}
          onChange={(event) => setFlowerLanguage(event.target.value)}
          placeholder="一句适合门店物料百科展示的中文花语"
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm text-zinc-700">
          供货周期
          <input
            className={`${inputClass} mt-1`}
            name="supplySeason"
            defaultValue={material?.supplySeason ?? ""}
            placeholder="如：全年、4-9月"
          />
        </label>
        <label className="block text-sm text-zinc-700">
          默认保质期（天）
          <input
            className={`${inputClass} mt-1`}
            name="defaultShelfLifeDays"
            type="number"
            min={1}
            step={1}
            defaultValue={material?.defaultShelfLifeDays ?? ""}
            placeholder="留空则不自动设到期"
          />
        </label>
      </div>

      <div className={sectionClass}>
        <p className="text-sm font-semibold text-emerald-900">标准成本（产品定价预估）</p>
        <p className="mt-1 text-xs text-emerald-800">
          标准成本用于产品定价预估；订单实际成本仍以入库批次成本为准。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_8rem]">
          <label className="block text-sm text-zinc-700">
            标准单位成本（元）
            <input
              className={`${inputClass} mt-1`}
              name="standardUnitCost"
              type="number"
              min={0}
              step={0.0001}
              defaultValue={material?.standardUnitCost ?? ""}
              placeholder="留空则视为未设置"
            />
          </label>
          <label className="block text-sm text-zinc-700">
            成本单位
            <input
              className={`${inputClass} mt-1`}
              name="costUnit"
              defaultValue={material?.costUnit ?? ""}
              placeholder="支"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm text-zinc-700">
          成本备注
          <textarea
            className={`${textareaClass} min-h-16`}
            name="costNote"
            defaultValue={material?.costNote ?? ""}
            placeholder="例如：按近 30 天常用品质采购均价估算"
          />
        </label>
      </div>

      <div className={sectionClass}>
        <p className="text-sm font-semibold text-sky-900">损耗成本模型</p>
        <p className="mt-1 text-xs text-sky-800">
          可用率按百分比填写（0–100）；保存时换算为 0–1。订单实际库存流水仍按真实批次扣减。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-zinc-700">
            乐观可用率（%）
            <input
              className={`${inputClass} mt-1`}
              name="optimisticUsableRate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              defaultValue={rateToPercent(material?.optimisticUsableRate)}
              placeholder="如 92"
            />
          </label>
          <label className="block text-sm text-zinc-700">
            标准可用率（%）
            <input
              className={`${inputClass} mt-1`}
              name="standardUsableRate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              defaultValue={rateToPercent(material?.standardUsableRate)}
              placeholder="如 85"
            />
          </label>
          <label className="block text-sm text-zinc-700">
            保守可用率（%）
            <input
              className={`${inputClass} mt-1`}
              name="conservativeUsableRate"
              type="number"
              min={0}
              max={100}
              step={0.01}
              defaultValue={rateToPercent(material?.conservativeUsableRate)}
              placeholder="如 75"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm text-zinc-700">
          损耗说明
          <textarea
            className={`${textareaClass} min-h-16`}
            name="lossRateNote"
            defaultValue={material?.lossRateNote ?? ""}
            placeholder="例如：夏季运输损耗偏高，标准按 80% 估算"
          />
        </label>
      </div>

      <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-700">养护指南</span>
          <div className="flex flex-wrap gap-2">
            {careMode === "table" ? (
              <button
                type="button"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                onClick={switchToText}
              >
                切换为文本编辑
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                onClick={switchToTable}
              >
                切换为表格编辑
              </button>
            )}
          </div>
        </div>

        <input
          type="hidden"
          name="careTable"
          value={
            careMode === "table" ? JSON.stringify(normalizeCareTable(careRows)) : ""
          }
          readOnly
        />

        {careMode === "table" ? (
          <div className="mt-3 space-y-2">
            <WikiCareTable rows={careRows} editable onChange={setCareRows} />
            <input
              type="hidden"
              name="maintenance"
              value={careTableToMaintenanceText(careRows) || maintenance}
              readOnly
            />
            <p className="text-xs text-zinc-500">
              表格有内容时，保存后自动生成养护指南文本；留空的行不会写入。
            </p>
          </div>
        ) : (
          <textarea
            className={`${textareaClass} mt-3 min-h-28`}
            name="maintenance"
            value={maintenance}
            onChange={(event) => setMaintenance(event.target.value)}
            placeholder={"如：醒花水位：需要深水醒花\n养护水位：花瓶1/2\n换水频率：每2天"}
          />
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-sm text-zinc-700">
          品牌
          <input
            className={`${inputClass} mt-1`}
            name="brand"
            defaultValue={material?.brand ?? ""}
          />
        </label>
        <label className="block text-sm text-zinc-700">
          型号
          <input
            className={`${inputClass} mt-1`}
            name="model"
            defaultValue={material?.model ?? ""}
          />
        </label>
        <label className="block text-sm text-zinc-700">
          安全库存阈值
          <input
            className={`${inputClass} mt-1`}
            name="safetyStockThreshold"
            type="number"
            min={0}
            step={0.001}
            defaultValue={material?.safetyStockThreshold ?? ""}
            placeholder="0"
          />
        </label>
      </div>

      <label className="block text-sm text-zinc-700">
        备注
        <textarea
          className={`${textareaClass} min-h-16`}
          name="notes"
          defaultValue={material?.notes ?? ""}
        />
      </label>

      <fieldset className="rounded-xl border border-zinc-200 p-3">
        <legend className="px-1 text-sm font-medium text-zinc-700">物料分类</legend>
        {categories.length === 0 ? (
          <p className="text-xs text-zinc-500">
            暂无物料分类。可先在物料分类页新增分类，再回到这里关联。
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {categories.map((category) => (
              <label
                key={category.id}
                className="flex items-center gap-2 text-sm text-zinc-700"
              >
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={category.id}
                  defaultChecked={material?.categoryIds.includes(category.id) ?? false}
                />
                <span>
                  {category.name}
                  {!category.active && (
                    <span className="text-xs text-zinc-400">（已停用）</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
