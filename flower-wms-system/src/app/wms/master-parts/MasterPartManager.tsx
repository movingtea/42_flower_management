"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { DrawerFooterActions } from "@/components/admin/DrawerFooterActions";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import {
  getDefaultMasterPartValues,
  MASTER_PART_TYPES,
  masterPartTypeLabels,
  type MasterPartType,
} from "@/lib/master-parts-pure";
import { formatNullableDateTime } from "@/lib/datetime";
import {
  STICKY_LEFT_CELL,
  STICKY_LEFT_HEAD,
  STICKY_RIGHT_CELL,
  STICKY_RIGHT_HEAD,
  STICKY_SCROLL_CELL,
  STICKY_SCROLL_HEAD,
  STICKY_ACTIONS,
  STICKY_TABLE_ROW,
  StickyTableScroll,
} from "@/components/admin/sticky-table";

type MasterPart = {
  id: string;
  tenantId: string | null;
  type: MasterPartType;
  name: string;
  spec: string | null;
  defaultUnit: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  isConsumable: boolean;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  type: MasterPartType;
  name: string;
  spec: string;
  defaultUnit: string;
  brand: string;
  model: string;
  color: string;
  isConsumable: boolean;
  isActive: boolean;
  note: string;
};

const defaults = getDefaultMasterPartValues();

const EMPTY_FORM: FormState = {
  type: defaults.type,
  name: "",
  spec: "",
  defaultUnit: "",
  brand: "",
  model: "",
  color: "",
  isConsumable: defaults.isConsumable,
  isActive: defaults.isActive,
  note: "",
};

function SelectField({
  label,
  requiredMark = false,
  value,
  onChange,
  children,
}: {
  label: string;
  requiredMark?: boolean;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">
        {label}
        {requiredMark ? <span className="ml-1 text-red-500">*</span> : null}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
      >
        {children}
      </select>
    </label>
  );
}

function formatDateTime(value: string) {
  return formatNullableDateTime(value);
}

export function MasterPartManager() {
  const [items, setItems] = useState<MasterPart[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [isActive, setIsActive] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (typeFilter) params.set("type", typeFilter);
    if (isActive) params.set("isActive", isActive);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [isActive, keyword, page, pageSize, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  const loadMasterParts = useCallback(async (nextQuery = "") => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/master-parts${nextQuery ? `?${nextQuery}` : ""}`
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          items?: MasterPart[];
          total?: number;
          page?: number;
          pageSize?: number;
        };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载通用物料失败");
      }
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载通用物料失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadMasterParts(queryString);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadMasterParts, queryString]);

  function resetFilters() {
    setKeyword("");
    setTypeFilter("");
    setIsActive("");
    setPage(1);
  }

  function updateKeyword(value: string) {
    setKeyword(value);
    setPage(1);
  }

  function updateTypeFilter(value: string) {
    setTypeFilter(value);
    setPage(1);
  }

  function updateIsActive(value: string) {
    setIsActive(value);
    setPage(1);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDrawerOpen(false);
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setDrawerOpen(true);
  }

  function startEdit(row: MasterPart) {
    setEditingId(row.id);
    setForm({
      type: row.type,
      name: row.name,
      spec: row.spec ?? "",
      defaultUnit: row.defaultUnit ?? "",
      brand: row.brand ?? "",
      model: row.model ?? "",
      color: row.color ?? "",
      isConsumable: row.isConsumable,
      isActive: row.isActive,
      note: row.note ?? "",
    });
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      showToast("请填写物料名称", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        type: form.type,
        name,
        spec: form.spec.trim() || null,
        defaultUnit: form.defaultUnit.trim() || null,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        color: form.color.trim() || null,
        isConsumable: form.isConsumable,
        isActive: form.isActive,
        note: form.note.trim() || null,
      };
      const url = editingId
        ? `/api/admin/master-parts/${editingId}`
        : "/api/admin/master-parts";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存通用物料失败");
      }
      showToast(json.data?.message ?? "通用物料已保存", "success");
      resetForm();
      await loadMasterParts(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存通用物料失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row: MasterPart) {
    if (!window.confirm(`确定停用通用物料「${row.name}」？`)) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/master-parts/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "停用通用物料失败");
      }
      showToast("通用物料已停用", "success");
      if (editingId === row.id) resetForm();
      await loadMasterParts(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "停用通用物料失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      {toast && (
        <div
          role="status"
          className={`fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900">通用物料母表</h2>
          <p className="mt-1 text-sm text-zinc-500">
            维护辅料、包装材料、工具与其他耗材主数据；花材仍使用「物料母表（FlowerWiki）」。
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          新增通用物料
        </Button>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              label="关键词搜索"
              placeholder="名称 / 规格 / 品牌 / 型号 / 颜色"
              value={keyword}
              onChange={(e) => updateKeyword(e.target.value)}
            />
            <SelectField label="物料类型" value={typeFilter} onChange={updateTypeFilter}>
              <option value="">全部类型</option>
              {MASTER_PART_TYPES.map((type) => (
                <option key={type} value={type}>
                  {masterPartTypeLabels[type]}
                </option>
              ))}
            </SelectField>
            <SelectField label="启用状态" value={isActive} onChange={updateIsActive}>
              <option value="">全部状态</option>
              <option value="true">已启用</option>
              <option value="false">已停用</option>
            </SelectField>
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={resetFilters}
                className="w-full"
              >
                清空筛选
              </Button>
            </div>
          </div>
          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <StickyTableScroll minWidth="1200px">
          <colgroup>
            <col className="w-40" />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col className="w-28" />
          </colgroup>
          <thead className="border-b bg-zinc-50">
            <tr>
              <th className={STICKY_LEFT_HEAD}>物料名称</th>
              <th className={STICKY_SCROLL_HEAD}>物料类型</th>
              <th className={STICKY_SCROLL_HEAD}>规格说明</th>
              <th className={STICKY_SCROLL_HEAD}>默认单位</th>
              <th className={STICKY_SCROLL_HEAD}>品牌</th>
              <th className={STICKY_SCROLL_HEAD}>型号</th>
              <th className={STICKY_SCROLL_HEAD}>颜色</th>
              <th className={STICKY_SCROLL_HEAD}>消耗品</th>
              <th className={STICKY_SCROLL_HEAD}>状态</th>
              <th className={STICKY_SCROLL_HEAD}>更新时间</th>
              <th className={STICKY_RIGHT_HEAD}>操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-zinc-500">
                  正在加载通用物料…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-zinc-500">
                  暂无通用物料，请先新增。
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className={STICKY_TABLE_ROW}>
                  <td className={STICKY_LEFT_CELL}>{row.name}</td>
                  <td className={STICKY_SCROLL_CELL}>
                    {masterPartTypeLabels[row.type]}
                  </td>
                  <td className={STICKY_SCROLL_CELL}>{row.spec || "—"}</td>
                  <td className={STICKY_SCROLL_CELL}>{row.defaultUnit || "—"}</td>
                  <td className={STICKY_SCROLL_CELL}>{row.brand || "—"}</td>
                  <td className={STICKY_SCROLL_CELL}>{row.model || "—"}</td>
                  <td className={STICKY_SCROLL_CELL}>{row.color || "—"}</td>
                  <td className={STICKY_SCROLL_CELL}>
                    {row.isConsumable ? "是" : "否"}
                  </td>
                  <td className={STICKY_SCROLL_CELL}>
                    {row.isActive ? (
                      <Badge variant="success">已启用</Badge>
                    ) : (
                      <Badge variant="default">已停用</Badge>
                    )}
                  </td>
                  <td className={`text-xs text-zinc-500 ${STICKY_SCROLL_CELL}`}>
                    {formatDateTime(row.updatedAt)}
                  </td>
                  <td className={STICKY_RIGHT_CELL}>
                    <div className={STICKY_ACTIONS}>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="text-rose-600 hover:underline"
                      >
                        编辑
                      </button>
                      {row.isActive && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(row)}
                          className="text-zinc-500 hover:text-red-600"
                        >
                          停用
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </StickyTableScroll>

        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm text-zinc-600">
          <span>
            共 {total} 条，第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>

      <AdminDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editingId ? "编辑通用物料" : "新增通用物料"}
        description="非花材主数据；采购单正式接入将在后续批次完成"
        size="md"
        closeOnOverlayClick={false}
        bodyClassName="space-y-3"
        footer={
          <DrawerFooterActions
            onCancel={resetForm}
            onConfirm={() => void handleSubmit()}
            confirmLoading={saving}
            confirmLabel={editingId ? "保存修改" : "创建通用物料"}
          />
        }
      >
        <SelectField
          label="物料类型"
          requiredMark
          value={form.type}
          onChange={(value) =>
            setForm((f) => ({ ...f, type: value as MasterPartType }))
          }
        >
          {MASTER_PART_TYPES.map((type) => (
            <option key={type} value={type}>
              {masterPartTypeLabels[type]}
            </option>
          ))}
        </SelectField>
        <Input
          label="物料名称"
          requiredMark
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          label="规格说明"
          value={form.spec}
          onChange={(e) => setForm((f) => ({ ...f, spec: e.target.value }))}
        />
        <Input
          label="默认单位"
          placeholder="如 件、卷、包"
          value={form.defaultUnit}
          onChange={(e) => setForm((f) => ({ ...f, defaultUnit: e.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="品牌"
            value={form.brand}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          />
          <Input
            label="型号"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
          <Input
            label="颜色"
            value={form.color}
            onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
          />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-700">备注</span>
          <textarea
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 px-3 py-2">
            <Switch
              label="是否消耗品"
              checked={form.isConsumable}
              onChange={(checked) =>
                setForm((f) => ({ ...f, isConsumable: checked }))
              }
            />
          </div>
          <div className="rounded-lg border border-zinc-200 px-3 py-2">
            <Switch
              label="是否启用"
              checked={form.isActive}
              onChange={(checked) =>
                setForm((f) => ({ ...f, isActive: checked }))
              }
            />
          </div>
        </div>
      </AdminDrawer>
    </div>
  );
}
