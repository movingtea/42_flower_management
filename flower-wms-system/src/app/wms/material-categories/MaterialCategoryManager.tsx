"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type { MaterialCategoryRow } from "@/lib/material-category";

type Props = {
  initialList: MaterialCategoryRow[];
};

type FormState = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  sortOrder: "10",
  isActive: true,
};

export function MaterialCategoryManager({ initialList }: Props) {
  const router = useRouter();
  const [list, setList] = useState(initialList);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(row: MaterialCategoryRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description ?? "",
      sortOrder: String(row.sortOrder),
      isActive: row.isActive,
    });
  }

  async function reloadList() {
    const res = await fetch("/api/admin/wms/material-categories");
    const json = (await res.json()) as {
      success: boolean;
      data?: { list?: MaterialCategoryRow[] };
    };
    if (res.ok && json.success && json.data?.list) {
      setList(json.data.list);
    }
  }

  async function handleSubmit() {
    const name = form.name.trim();
    const sortOrder = Number(form.sortOrder);
    if (!name) {
      showToast("请填写分类名称", "error");
      return;
    }
    if (!Number.isFinite(sortOrder)) {
      showToast("排序权重须为数字", "error");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || null,
      sortOrder: Math.round(sortOrder),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/wms/material-categories/${editingId}`
        : "/api/admin/wms/material-categories";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }
      showToast(json.data?.message ?? "保存成功", "success");
      resetForm();
      await reloadList();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: MaterialCategoryRow) {
    if (!window.confirm(`确定删除原材料分类「${row.name}」？`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/wms/material-categories/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      showToast("已删除", "success");
      if (editingId === row.id) resetForm();
      await reloadList();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "删除失败", "error");
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

      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-zinc-900">原材料分类管理</h2>
        <p className="mt-1 text-sm text-zinc-500">
          WMS 仓储专用单层大类，用于采购入库时标注花材类型；与商城商品分类无关。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">分类名称</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">排序权重</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-zinc-500">
                      暂无原材料分类
                    </td>
                  </tr>
                ) : (
                  list.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3">{row.sortOrder}</td>
                      <td className="px-4 py-3">
                        {row.isActive ? (
                          <Badge variant="success">已启用</Badge>
                        ) : (
                          <Badge variant="default">已禁用</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="mr-3 text-rose-600 hover:underline"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="text-zinc-500 hover:text-red-600"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-2 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-zinc-900">
            {editingId ? "编辑原材料分类" : "新建原材料分类"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">单层分类，无需选择上级节点</p>

          <div className="mt-5 space-y-4">
            <Input
              label="分类名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">分类描述</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <Input
              label="排序权重"
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm((f) => ({ ...f, sortOrder: e.target.value }))
              }
            />
            <div className="rounded-lg border border-zinc-200 px-4 py-3">
              <Switch
                label="启用状态"
                checked={form.isActive}
                onChange={(checked) =>
                  setForm((f) => ({ ...f, isActive: checked }))
                }
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={handleSubmit} disabled={saving}>
                {saving ? "保存中…" : editingId ? "保存修改" : "创建分类"}
              </Button>
              {editingId && (
                <Button type="button" variant="ghost" onClick={resetForm}>
                  取消
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
