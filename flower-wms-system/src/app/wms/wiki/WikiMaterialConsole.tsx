"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDeferredEffect } from "@/lib/defer-effect";
import { WikiCareTable } from "@/components/wiki/WikiCareTable";
import { WikiMaterialDetailDrawer } from "@/components/wiki/WikiMaterialDetailModal";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { WikiTableTruncatedText } from "@/components/wiki/WikiTableTruncatedText";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPercent } from "@/lib/format-money";
import {
  WIKI_MAINTENANCE_TEMPLATE,
  type WikiListItem,
} from "@/lib/wiki-constants";
import {
  careTableToMaintenanceText,
  emptyCareTable,
  normalizeCareTable,
  validateCareTableForSave,
  WIKI_CARE_ROW_SPECS,
  type WikiCareRow,
} from "@/lib/wiki-care";

type FormState = {
  name: string;
  englishName: string;
  flowerLanguage: string;
  availability: string;
  maintenance: string;
  defaultShelfLifeDays: string;
  standardUnitCost: string;
  costUnit: string;
  costNote: string;
  optimisticUsableRate: string;
  standardUsableRate: string;
  conservativeUsableRate: string;
  lossRateNote: string;
};

type CareEditorMode = "text" | "table";

const EMPTY_FORM: FormState = {
  name: "",
  englishName: "",
  flowerLanguage: "",
  availability: "",
  maintenance: WIKI_MAINTENANCE_TEMPLATE,
  defaultShelfLifeDays: "",
  standardUnitCost: "",
  costUnit: "支",
  costNote: "",
  optimisticUsableRate: "",
  standardUsableRate: "",
  conservativeUsableRate: "",
  lossRateNote: "",
};

function toForm(item: WikiListItem): FormState {
  return {
    name: item.chineseName,
    englishName: item.englishName,
    flowerLanguage: item.flowerLanguage ?? "",
    availability: item.supplySeason ?? item.availability ?? "",
    maintenance: item.maintenance,
    defaultShelfLifeDays:
      item.defaultShelfLifeDays != null ? String(item.defaultShelfLifeDays) : "",
    standardUnitCost: item.standardUnitCost ?? "",
    costUnit: item.costUnit ?? "支",
    costNote: item.costNote ?? "",
    optimisticUsableRate: item.optimisticUsableRate
      ? String(Number(item.optimisticUsableRate) * 100)
      : "",
    standardUsableRate: item.standardUsableRate
      ? String(Number(item.standardUsableRate) * 100)
      : item.defaultUsableRate
        ? String(Number(item.defaultUsableRate) * 100)
        : "",
    conservativeUsableRate: item.conservativeUsableRate
      ? String(Number(item.conservativeUsableRate) * 100)
      : "",
    lossRateNote: item.lossRateNote ?? "",
  };
}

function toPayload(
  form: FormState,
  options: {
    preservedMorphology?: string | null;
    preservedColorTags?: string[] | null;
    preservedFloralRole?: WikiListItem["floralRole"] | null;
    careTable: WikiCareRow[] | null;
    careMode: CareEditorMode;
  }
) {
  const defaultShelfLifeDays = form.defaultShelfLifeDays.trim();
  const standardUnitCost = form.standardUnitCost.trim();
  const useTable =
    options.careMode === "table" &&
    options.careTable &&
    validateCareTableForSave(options.careTable);

  return {
    name: form.name.trim(),
    englishName: form.englishName.trim(),
    colorTags: options.preservedColorTags ?? [],
    floralRole: options.preservedFloralRole ?? undefined,
    flowerLanguage: form.flowerLanguage.trim() || null,
    texture: options.preservedMorphology?.trim() || null,
    availability: form.availability.trim() || null,
    maintenance: useTable
      ? careTableToMaintenanceText(options.careTable!)
      : form.maintenance.trim(),
    careTable: useTable ? normalizeCareTable(options.careTable!) : null,
    defaultShelfLifeDays: defaultShelfLifeDays
      ? Number(defaultShelfLifeDays)
      : null,
    standardUnitCost: standardUnitCost ? Number(standardUnitCost) : null,
    costUnit: form.costUnit.trim() || (standardUnitCost ? "支" : null),
    costNote: form.costNote.trim() || null,
    optimisticUsableRate: form.optimisticUsableRate.trim() || null,
    standardUsableRate: form.standardUsableRate.trim() || null,
    conservativeUsableRate: form.conservativeUsableRate.trim() || null,
    lossRateNote: form.lossRateNote.trim() || null,
  };
}

const WIKI_TABLE_COL_COUNT = 7 + WIKI_CARE_ROW_SPECS.length + 1;

import {
  STICKY_LEFT_CELL as STICKY_NAME_CELL,
  STICKY_LEFT_HEAD as STICKY_NAME_HEAD,
  STICKY_RIGHT_CELL as STICKY_ACTION_CELL,
  STICKY_RIGHT_HEAD as STICKY_ACTION_HEAD,
  STICKY_TABLE_ROW,
} from "@/components/admin/sticky-table";

/** 固定列宽 + 换行，防止文字溢出到相邻列（宽度由 colgroup 控制） */
const WIKI_WRAP_CELL =
  "overflow-hidden break-words whitespace-normal align-top bg-inherit px-3 py-3 text-zinc-600";

const WIKI_WRAP_CELL_EMPTY =
  "overflow-hidden align-top bg-inherit px-3 py-3 text-zinc-400";

const WIKI_COMPACT_CELL =
  "overflow-hidden break-words whitespace-normal align-top bg-inherit px-3 py-3 text-zinc-600";

function careValueByKey(item: WikiListItem, key: string): string {
  if (!item.careTable?.length) return "";
  const row = item.careTable.find((entry) => entry.key === key);
  return row?.value.trim() ?? "";
}

function WikiTableCell({ value }: { value: string }) {
  if (!value) {
    return <td className={WIKI_WRAP_CELL_EMPTY}>—</td>;
  }
  return (
    <td className={WIKI_WRAP_CELL}>
      <WikiTableTruncatedText text={value} />
    </td>
  );
}

function formatWikiCost(item: WikiListItem) {
  if (!item.standardUnitCost) return "未设置";
  return `¥${Number(item.standardUnitCost).toFixed(2)} / ${item.costUnit || "支"}`;
}

function formatWikiLossProfile(item: WikiListItem) {
  const rate = item.standardUsableRate ?? item.defaultUsableRate;
  if (!rate) return "未设置，默认按标准 85% 估算";
  const usable = Number(rate);
  if (!Number.isFinite(usable)) return "未设置，默认按标准 85% 估算";
  const loss = 1 - usable;
  return `${formatPercent(usable)} / ${formatPercent(loss)}`;
}

export function WikiMaterialConsole() {
  const [items, setItems] = useState<WikiListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewItem, setViewItem] = useState<WikiListItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMorphology, setEditingMorphology] = useState<string | null>(null);
  const [editingColorTags, setEditingColorTags] = useState<string[] | null>(null);
  const [editingFloralRole, setEditingFloralRole] = useState<
    WikiListItem["floralRole"] | null
  >(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [careMode, setCareMode] = useState<CareEditorMode>("text");
  const [careTable, setCareTable] = useState<WikiCareRow[]>(emptyCareTable());
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const pageSize = 20;
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total]
  );

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  function resetCareEditor(mode: CareEditorMode = "text") {
    setCareMode(mode);
    setCareTable(emptyCareTable());
  }

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
      const res = await fetch(`/api/admin/wiki?${params.toString()}`);
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { items?: WikiListItem[]; total?: number };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载失败");
      }
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQ]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useDeferredEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  useDeferredEffect(() => loadList(), [loadList]);

  function openView(item: WikiListItem) {
    setViewItem(item);
  }

  function closeView() {
    setViewItem(null);
  }

  function openEditFromView(item: WikiListItem) {
    closeView();
    openEdit(item);
  }

  function openCreate() {
    setEditingId(null);
    setEditingMorphology(null);
    setEditingColorTags(null);
    setEditingFloralRole(null);
    setForm({ ...EMPTY_FORM });
    resetCareEditor("text");
    setModalOpen(true);
  }

  function openEdit(item: WikiListItem) {
    setEditingId(item.id);
    setEditingMorphology(item.morphology);
    setEditingColorTags(item.colorTags);
    setEditingFloralRole(item.floralRole);
    setForm(toForm(item));
    if (item.careTable?.length) {
      setCareTable(normalizeCareTable(item.careTable));
      setCareMode("table");
    } else {
      resetCareEditor("text");
    }
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setEditingMorphology(null);
    setEditingColorTags(null);
    setEditingFloralRole(null);
    setForm({ ...EMPTY_FORM });
    resetCareEditor("text");
  }

  async function handleAiComplete() {
    const flowerName = form.name.trim();
    if (!flowerName) {
      showToast("请先填写中文常用名", "error");
      return;
    }

    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/complete-flower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flowerName }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          combinedEnglishName?: string;
          latinName?: string;
          englishName?: string;
          flowerLanguage?: string;
          careTable?: WikiCareRow[];
          cachedHint?: string;
        };
      };

      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "AI 补全失败");
      }

      const data = json.data;

      const combined =
        data.combinedEnglishName ||
        [data.latinName, data.englishName]
          .filter(Boolean)
          .join(" / ");

      setForm((prev) => ({
        ...prev,
        englishName: combined,
        flowerLanguage: data.flowerLanguage ?? prev.flowerLanguage,
        maintenance: data.careTable
          ? careTableToMaintenanceText(data.careTable)
          : prev.maintenance,
      }));

      if (data.careTable?.length) {
        setCareTable(normalizeCareTable(data.careTable));
        setCareMode("table");
      }

      showToast(
        data.cachedHint
          ? `AI 补全成功（${data.cachedHint}）`
          : "AI 智能补全成功",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "AI 补全失败", "error");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      showToast("请填写中文常用名", "error");
      return;
    }
    if (!form.englishName.trim()) {
      showToast("请填写拉丁学名", "error");
      return;
    }
    const hasTableCare =
      careMode === "table" && validateCareTableForSave(careTable);
    if (!hasTableCare && !form.maintenance.trim()) {
      showToast("请填写养护指南", "error");
      return;
    }

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/wiki/${editingId}`
        : "/api/admin/wiki";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          toPayload(form, {
            preservedMorphology: editingMorphology,
            preservedColorTags: editingColorTags,
            preservedFloralRole: editingFloralRole,
            careTable: hasTableCare ? careTable : null,
            careMode,
          })
        ),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }
      showToast(json.data?.message ?? "保存成功", "success");
      closeModal();
      await loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: WikiListItem) {
    if (!window.confirm(`确定删除「${item.chineseName}」？此操作不可恢复。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/wiki/${item.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      showToast("已删除", "success");
      await loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败", "error");
    }
  }

  async function handleQuickCostEdit(item: WikiListItem) {
    const current = item.standardUnitCost
      ? Number(item.standardUnitCost).toFixed(2)
      : "";
    const input = window.prompt(
      `设置「${item.chineseName}」标准单支成本（元/${item.costUnit || "支"}）\n标准成本用于产品定价预估；订单实际成本仍以入库批次成本为准。`,
      current
    );
    if (input === null) return;
    const trimmed = input.trim();
    const nextCost = trimmed ? Number(trimmed) : null;
    if (nextCost !== null && (!Number.isFinite(nextCost) || nextCost < 0)) {
      showToast("标准单支成本须为非负数字", "error");
      return;
    }

    try {
      const payload = toPayload(
        {
          ...toForm(item),
          standardUnitCost: nextCost === null ? "" : nextCost.toFixed(2),
          costUnit: item.costUnit || "支",
        },
        {
          preservedMorphology: item.morphology,
          preservedColorTags: item.colorTags,
          preservedFloralRole: item.floralRole,
          careTable: item.careTable,
          careMode: item.careTable?.length ? "table" : "text",
        }
      );
      const res = await fetch(`/api/admin/wiki/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "成本更新失败");
      }
      showToast("标准成本已更新", "success");
      await loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "成本更新失败", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">基础物料母表</h1>
          <p className="mt-1 text-sm text-zinc-500">
            FlowerWiki 数字化智库 · 支持简拼 / 中文 / 拉丁名检索
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          新增物料
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[280px] flex-1">
          <Input
            label="搜索"
            placeholder="简拼 / 中文名 / 拉丁学名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-sm text-zinc-500">共 {total} 条</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full min-w-[72rem] table-fixed text-sm">
          <colgroup>
            <col className="w-24" />
            <col className="w-[6%]" />
            <col className="w-[5%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            {WIKI_CARE_ROW_SPECS.map((spec) => (
              <col key={spec.key} className="w-[9%]" />
            ))}
            <col className="w-36" />
          </colgroup>
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className={STICKY_NAME_HEAD}>花名</th>
              <th className={`${WIKI_COMPACT_CELL} bg-zinc-50 font-medium`}>
                供货时间
              </th>
              <th className="bg-zinc-50 px-3 py-3 font-medium">保质期</th>
              <th className="bg-zinc-50 px-3 py-3 font-medium">标准成本</th>
              <th className="bg-zinc-50 px-3 py-3 font-medium">
                标准可用率 / 损耗率
              </th>
              <th className={`${WIKI_WRAP_CELL} bg-zinc-50 font-medium`}>
                花语
              </th>
              {WIKI_CARE_ROW_SPECS.map((spec) => (
                <th
                  key={spec.key}
                  className={`${WIKI_WRAP_CELL} bg-zinc-50 font-medium`}
                >
                  {spec.label}
                </th>
              ))}
              <th className={STICKY_ACTION_HEAD}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={WIKI_TABLE_COL_COUNT}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td
                  colSpan={WIKI_TABLE_COL_COUNT}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  暂无物料，点击「新增物料」开始录入
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.id}
                  className={`${STICKY_TABLE_ROW} border-t border-zinc-100`}
                >
                  <td className={`${STICKY_NAME_CELL} align-top`}>
                    <button
                      type="button"
                      onClick={() => openView(item)}
                      className="whitespace-normal break-words text-left font-medium text-rose-700 underline-offset-2 hover:text-rose-900 hover:underline"
                      title={item.chineseName}
                    >
                      {item.chineseName}
                    </button>
                  </td>
                  <td className={WIKI_COMPACT_CELL}>
                    {item.supplySeason ?? "—"}
                  </td>
                  <td className={`${WIKI_COMPACT_CELL} text-zinc-600`}>
                    {item.defaultShelfLifeDays != null
                      ? `${item.defaultShelfLifeDays} 天`
                      : "—"}
                  </td>
                  <td className={`${WIKI_COMPACT_CELL} text-zinc-600`}>
                    <button
                      type="button"
                      onClick={() => void handleQuickCostEdit(item)}
                      className={`text-left underline-offset-2 hover:underline ${
                        item.standardUnitCost
                          ? "font-semibold text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {formatWikiCost(item)}
                    </button>
                  </td>
                  <td className={`${WIKI_COMPACT_CELL} text-zinc-600`}>
                    {formatWikiLossProfile(item)}
                  </td>
                  <td className={WIKI_WRAP_CELL}>
                    {item.flowerLanguage?.trim() ? (
                      <WikiTableTruncatedText text={item.flowerLanguage.trim()} />
                    ) : (
                      "—"
                    )}
                  </td>
                  {WIKI_CARE_ROW_SPECS.map((spec) => (
                    <WikiTableCell
                      key={spec.key}
                      value={careValueByKey(item, spec.key)}
                    />
                  ))}
                  <td className={`${STICKY_ACTION_CELL} align-top`}>
                    <div className="flex shrink-0 justify-end gap-2 whitespace-nowrap">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        onClick={() => openEdit(item)}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 px-3 text-xs text-red-600 hover:text-red-700"
                        onClick={() => void handleDelete(item)}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-sm text-zinc-600">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {viewItem ? (
        <WikiMaterialDetailDrawer
          item={viewItem}
          open={Boolean(viewItem)}
          onOpenChange={(open) => {
            if (!open) closeView();
          }}
          onEdit={() => openEditFromView(viewItem)}
        />
      ) : null}

      <AdminDrawer
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
        title={editingId ? "编辑物料" : "新增物料"}
        size="lg"
        closeOnOverlayClick={false}
        bodyClassName="space-y-3"
        footer={
          <DrawerFooterActions
            onCancel={closeModal}
            onConfirm={() => void handleSubmit()}
            confirmLoading={saving}
            confirmDisabled={aiLoading}
          />
        }
      >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <Input
                        label="中文常用名"
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={aiLoading || saving}
                      className="shrink-0 border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                      onClick={() => void handleAiComplete()}
                    >
                      {aiLoading ? "AI 补全中…" : "✨ AI 一键智能补全"}
                    </Button>
                  </div>
                </div>

                <Input
                  label="拉丁学名 / 英文名"
                  value={form.englishName}
                  onChange={(e) =>
                    setForm({ ...form, englishName: e.target.value })
                  }
                  className="sm:col-span-2"
                />

                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium text-zinc-700">
                    花语
                  </span>
                  <textarea
                    rows={3}
                    placeholder="AI 一键智能补全后自动生成，也可手动调整"
                    value={form.flowerLanguage}
                    onChange={(e) =>
                      setForm({ ...form, flowerLanguage: e.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                  />
                </label>
                <Input
                  label="供货周期"
                  placeholder="如：全年、4-9月"
                  value={form.availability}
                  onChange={(e) =>
                    setForm({ ...form, availability: e.target.value })
                  }
                />
                <Input
                  label="默认保质期（天）"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="如：7；留空则不自动设到期"
                  value={form.defaultShelfLifeDays}
                  onChange={(e) =>
                    setForm({ ...form, defaultShelfLifeDays: e.target.value })
                  }
                />

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:col-span-2">
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-emerald-900">
                      标准成本（产品定价预估）
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      标准成本用于产品定价预估；订单实际成本仍以入库批次成本为准。
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <Input
                      label="标准单支成本（元）"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.0001}
                      placeholder="留空则视为未设置"
                      value={form.standardUnitCost}
                      onChange={(e) =>
                        setForm({ ...form, standardUnitCost: e.target.value })
                      }
                    />
                    <Input
                      label="成本单位"
                      placeholder="支"
                      value={form.costUnit}
                      onChange={(e) =>
                        setForm({ ...form, costUnit: e.target.value })
                      }
                    />
                  </div>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">
                      成本备注
                    </span>
                    <textarea
                      rows={2}
                      value={form.costNote}
                      onChange={(e) =>
                        setForm({ ...form, costNote: e.target.value })
                      }
                      placeholder="例如：按近 30 天常用品质采购均价估算"
                      className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-400"
                    />
                  </label>
                </div>

                <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 sm:col-span-2">
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-sky-900">
                      损耗成本模型
                    </p>
                    <p className="mt-1 text-xs text-sky-800">
                      可用率用于把不可避免的鲜花损耗摊进产品成本。订单实际库存流水仍按真实批次扣减。
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      label="乐观可用率"
                      placeholder="如 92、92% 或 0.92"
                      value={form.optimisticUsableRate}
                      onChange={(e) =>
                        setForm({ ...form, optimisticUsableRate: e.target.value })
                      }
                    />
                    <Input
                      label="标准可用率"
                      placeholder="如 85、85% 或 0.85"
                      value={form.standardUsableRate}
                      onChange={(e) =>
                        setForm({ ...form, standardUsableRate: e.target.value })
                      }
                    />
                    <Input
                      label="保守可用率"
                      placeholder="如 75、75% 或 0.75"
                      value={form.conservativeUsableRate}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          conservativeUsableRate: e.target.value,
                        })
                      }
                    />
                  </div>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block font-medium text-zinc-700">
                      损耗说明
                    </span>
                    <textarea
                      rows={2}
                      value={form.lossRateNote}
                      onChange={(e) =>
                        setForm({ ...form, lossRateNote: e.target.value })
                      }
                      placeholder="例如：夏季运输损耗偏高，标准按 80% 估算"
                      className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-sky-400"
                    />
                  </label>
                </div>

                <div className="space-y-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-700">
                      养护指南
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {careMode === "table" ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 px-3 text-xs"
                            disabled={aiLoading || saving}
                            onClick={() => void handleAiComplete()}
                          >
                            重新生成
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 px-3 text-xs"
                            onClick={() => {
                              setCareMode("text");
                              setForm((prev) => ({
                                ...prev,
                                maintenance: careTableToMaintenanceText(careTable),
                              }));
                            }}
                          >
                            切换为文本编辑
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 px-3 text-xs"
                          disabled={!validateCareTableForSave(careTable)}
                          onClick={() => {
                            setCareMode("table");
                            if (!validateCareTableForSave(careTable)) {
                              setCareTable(emptyCareTable());
                            }
                          }}
                        >
                          切换为表格编辑
                        </Button>
                      )}
                    </div>
                  </div>

                  {careMode === "table" ? (
                    <WikiCareTable
                      rows={careTable}
                      editable
                      onChange={setCareTable}
                    />
                  ) : (
                    <textarea
                      rows={4}
                      value={form.maintenance}
                      onChange={(e) =>
                        setForm({ ...form, maintenance: e.target.value })
                      }
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                    />
                  )}
                </div>
              </div>
      </AdminDrawer>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[60] rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
