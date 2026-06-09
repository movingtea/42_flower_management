"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type { PackagingKitRow } from "@/lib/packaging-kit";

type Props = {
  initialList: PackagingKitRow[];
};

type FormState = {
  name: string;
  description: string;
  standardCost: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  standardCost: "0.00",
  isActive: true,
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PackagingKitManager({ initialList }: Props) {
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

  function startEdit(row: PackagingKitRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description ?? "",
      standardCost: row.standardCost,
      isActive: row.isActive,
    });
  }

  async function reloadList() {
    const res = await fetch("/api/admin/wms/packaging-kits");
    const json = (await res.json()) as {
      success: boolean;
      data?: { list?: PackagingKitRow[] };
    };
    if (res.ok && json.success && json.data?.list) {
      setList(json.data.list);
    }
  }

  async function handleSubmit() {
    const name = form.name.trim();
    const standardCost = Number(form.standardCost);
    if (!name) {
      showToast("请填写包装方案名称", "error");
      return;
    }
    if (!Number.isFinite(standardCost) || standardCost < 0) {
      showToast("标准成本须为非负数字", "error");
      return;
    }

    const payload = {
      name,
      description: form.description.trim() || null,
      standardCost: standardCost.toFixed(2),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/wms/packaging-kits/${editingId}`
        : "/api/admin/wms/packaging-kits";
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

  async function handleDeactivate(row: PackagingKitRow) {
    if (!window.confirm(`确定停用包装方案「${row.name}」？`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/wms/packaging-kits/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "停用失败");
      }
      showToast("已停用", "success");
      if (editingId === row.id) resetForm();
      await reloadList();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "停用失败", "error");
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
        <h2 className="text-2xl font-semibold text-zinc-900">包装方案管理</h2>
        <p className="mt-1 text-sm text-zinc-500">
          维护订单毛利核算使用的标准包装成本；本阶段不扣减包装耗材库存。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm lg:col-span-3">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">名称</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    标准成本
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">描述</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    更新时间
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-zinc-500"
                    >
                      暂无包装方案
                    </td>
                  </tr>
                ) : (
                  list.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 font-semibold text-rose-800">
                        ¥{row.standardCost}
                      </td>
                      <td className="max-w-56 px-4 py-3 text-zinc-600">
                        {row.description || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.isActive ? (
                          <Badge variant="success">已启用</Badge>
                        ) : (
                          <Badge variant="default">已停用</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatTime(row.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="mr-3 text-rose-600 hover:underline"
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
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="font-semibold text-zinc-900">
            {editingId ? "编辑包装方案" : "新建包装方案"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            标准成本会乘以订单商品数量计入包装成本。
          </p>

          <div className="mt-5 space-y-4">
            <Input
              label="方案名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Input
              label="标准成本"
              type="number"
              min="0"
              step="0.01"
              value={form.standardCost}
              onChange={(e) =>
                setForm((f) => ({ ...f, standardCost: e.target.value }))
              }
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">描述</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
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
                {saving ? "保存中…" : editingId ? "保存修改" : "创建方案"}
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
