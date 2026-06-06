"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WikiCareTable } from "@/components/wiki/WikiCareTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FLORAL_ROLE_LABEL,
  WIKI_MAINTENANCE_TEMPLATE,
  roleBadgeClass,
  type WikiListItem,
} from "@/lib/wiki-constants";
import {
  careTableToMaintenanceText,
  emptyCareTable,
  normalizeCareTable,
  validateCareTableForSave,
  type WikiCareRow,
} from "@/lib/wiki-care";
import { FloralRole } from "@/generated/prisma/enums";

type FormState = {
  name: string;
  englishName: string;
  role: FloralRole;
  color: string;
  availability: string;
  maintenance: string;
  defaultShelfLifeDays: string;
};

type CareEditorMode = "text" | "table";

const EMPTY_FORM: FormState = {
  name: "",
  englishName: "",
  role: FloralRole.MAIN,
  color: "",
  availability: "",
  maintenance: WIKI_MAINTENANCE_TEMPLATE,
  defaultShelfLifeDays: "",
};

function toForm(item: WikiListItem): FormState {
  return {
    name: item.chineseName,
    englishName: item.englishName,
    role: item.floralRole,
    color: item.colorTags[0] ?? item.color ?? "",
    availability: item.supplySeason ?? item.availability ?? "",
    maintenance: item.maintenance,
    defaultShelfLifeDays:
      item.defaultShelfLifeDays != null ? String(item.defaultShelfLifeDays) : "",
  };
}

function toPayload(
  form: FormState,
  options: {
    preservedMorphology?: string | null;
    careTable: WikiCareRow[] | null;
    careMode: CareEditorMode;
  }
) {
  const defaultShelfLifeDays = form.defaultShelfLifeDays.trim();
  const useTable =
    options.careMode === "table" &&
    options.careTable &&
    validateCareTableForSave(options.careTable);

  return {
    name: form.name.trim(),
    englishName: form.englishName.trim(),
    role: FLORAL_ROLE_LABEL[form.role],
    color: form.color.trim(),
    texture: options.preservedMorphology?.trim() || null,
    availability: form.availability.trim() || null,
    maintenance: useTable
      ? careTableToMaintenanceText(options.careTable!)
      : form.maintenance.trim(),
    careTable: useTable ? normalizeCareTable(options.careTable!) : null,
    defaultShelfLifeDays: defaultShelfLifeDays
      ? Number(defaultShelfLifeDays)
      : null,
  };
}

export function WikiMaterialConsole() {
  const [items, setItems] = useState<WikiListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMorphology, setEditingMorphology] = useState<string | null>(null);
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

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function openCreate() {
    setEditingId(null);
    setEditingMorphology(null);
    setForm({ ...EMPTY_FORM });
    resetCareEditor("text");
    setModalOpen(true);
  }

  function openEdit(item: WikiListItem) {
    setEditingId(item.id);
    setEditingMorphology(item.morphology);
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
    if (!form.color.trim()) {
      showToast("请填写色系标签", "error");
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

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-zinc-100 bg-zinc-50/80 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">中文名</th>
              <th className="px-4 py-3 font-medium">拉丁学名</th>
              <th className="px-4 py-3 font-medium">简拼</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">色系</th>
              <th className="px-4 py-3 font-medium">供货</th>
              <th className="px-4 py-3 font-medium">保质期</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  暂无物料，点击「新增物料」开始录入
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-zinc-100 hover:bg-zinc-50/50"
                >
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    {item.chineseName}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{item.englishName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {item.pinyinIndex || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(item.floralRole)}`}
                    >
                      {FLORAL_ROLE_LABEL[item.floralRole]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {item.colorTags.join("、") || "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {item.supplySeason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">
                    {item.defaultShelfLifeDays != null
                      ? `${item.defaultShelfLifeDays} 天`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[min(90vh,760px)] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="border-b border-zinc-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-zinc-900">
                {editingId ? "编辑物料" : "新增物料"}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-zinc-700">
                    花艺核心角色
                  </span>
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm({ ...form, role: e.target.value as FloralRole })
                    }
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                  >
                    {(Object.entries(FLORAL_ROLE_LABEL) as [FloralRole, string][]).map(
                      ([role, label]) => (
                        <option key={role} value={role}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <Input
                  label="色系标签"
                  placeholder="如：香槟色、复古粉"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
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
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-100 px-6 py-4">
              <Button type="button" variant="secondary" onClick={closeModal}>
                取消
              </Button>
              <Button
                type="button"
                disabled={saving || aiLoading}
                onClick={() => void handleSubmit()}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
