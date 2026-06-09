"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import {
  formatDateTime,
  supplierTypeLabels,
  type Supplier,
  type SupplierType,
} from "@/app/wms/purchase-orders/types";

type FormState = {
  name: string;
  supplierType: SupplierType;
  contactName: string;
  phone: string;
  wechat: string;
  address: string;
  note: string;
  isActive: boolean;
};

const supplierTypeOptions = Object.entries(supplierTypeLabels) as Array<
  [SupplierType, string]
>;

const EMPTY_FORM: FormState = {
  name: "",
  supplierType: "LOCAL",
  contactName: "",
  phone: "",
  wechat: "",
  address: "",
  note: "",
  isActive: true,
};

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
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

export function SupplierManager() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [q, setQ] = useState("");
  const [supplierType, setSupplierType] = useState("");
  const [isActive, setIsActive] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (supplierType) params.set("supplierType", supplierType);
    if (isActive) params.set("isActive", isActive);
    return params.toString();
  }, [isActive, q, supplierType]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  const loadSuppliers = useCallback(async (nextQuery = "") => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/wms/suppliers${nextQuery ? `?${nextQuery}` : ""}`
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: { items?: Supplier[] };
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "加载供应商失败");
      }
      setItems(json.data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载供应商失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadSuppliers(queryString);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadSuppliers, queryString]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(row: Supplier) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      supplierType: row.supplierType,
      contactName: row.contactName ?? "",
      phone: row.phone ?? "",
      wechat: row.wechat ?? "",
      address: row.address ?? "",
      note: row.note ?? "",
      isActive: row.isActive,
    });
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      showToast("请填写供应商名称", "error");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name,
        supplierType: form.supplierType,
        contactName: form.contactName.trim() || null,
        phone: form.phone.trim() || null,
        wechat: form.wechat.trim() || null,
        address: form.address.trim() || null,
        note: form.note.trim() || null,
        isActive: form.isActive,
      };
      const url = editingId
        ? `/api/admin/wms/suppliers/${editingId}`
        : "/api/admin/wms/suppliers";
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
        throw new Error(json.error ?? "保存供应商失败");
      }
      showToast(json.data?.message ?? "供应商已保存", "success");
      resetForm();
      await loadSuppliers(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存供应商失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row: Supplier) {
    if (!window.confirm(`确定停用供应商「${row.name}」？历史采购单仍可查看。`)) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/wms/suppliers/${row.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "停用供应商失败");
      }
      showToast("供应商已停用", "success");
      if (editingId === row.id) resetForm();
      await loadSuppliers(queryString);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "停用供应商失败", "error");
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
          <h2 className="text-2xl font-semibold text-zinc-900">供应商管理</h2>
          <p className="mt-1 text-sm text-zinc-500">
            维护花材采购来源、联系人和启用状态；停用供应商不会影响历史采购单。
          </p>
        </div>
        <Button type="button" onClick={resetForm}>
          新增供应商
        </Button>
      </header>

      <div className="grid gap-8 xl:grid-cols-5">
        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm xl:col-span-3">
          <div className="border-b border-zinc-100 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input
                label="搜索"
                placeholder="名称 / 联系人 / 电话 / 微信"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <SelectField
                label="供应商类型"
                value={supplierType}
                onChange={setSupplierType}
              >
                <option value="">全部类型</option>
                {supplierTypeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="启用状态" value={isActive} onChange={setIsActive}>
                <option value="">全部状态</option>
                <option value="true">已启用</option>
                <option value="false">已停用</option>
              </SelectField>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setQ("");
                    setSupplierType("");
                    setIsActive("");
                  }}
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">供应商名称</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">类型</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">联系人</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">电话</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">微信</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">地址</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">更新时间</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-zinc-500">
                      正在加载供应商…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-zinc-500">
                      暂无供应商，请先创建供应商。
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50/80">
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {row.name}
                      </td>
                      <td className="px-4 py-3">
                        {supplierTypeLabels[row.supplierType]}
                      </td>
                      <td className="px-4 py-3">{row.contactName || "—"}</td>
                      <td className="px-4 py-3">{row.phone || "—"}</td>
                      <td className="px-4 py-3">{row.wechat || "—"}</td>
                      <td className="max-w-56 px-4 py-3 text-zinc-600">
                        <span className="line-clamp-2">{row.address || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        {row.isActive ? (
                          <Badge variant="success">已启用</Badge>
                        ) : (
                          <Badge variant="default">已停用</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {formatDateTime(row.updatedAt)}
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

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h3 className="font-semibold text-zinc-900">
            {editingId ? "编辑供应商" : "新增供应商"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            新建采购单时默认只选择已启用供应商。
          </p>

          <div className="mt-5 space-y-4">
            <Input
              label="供应商名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <SelectField
              label="供应商类型"
              value={form.supplierType}
              onChange={(value) =>
                setForm((f) => ({ ...f, supplierType: value as SupplierType }))
              }
            >
              {supplierTypeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Input
                label="联系人"
                value={form.contactName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, contactName: e.target.value }))
                }
              />
              <Input
                label="电话"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
              />
              <Input
                label="微信"
                value={form.wechat}
                onChange={(e) =>
                  setForm((f) => ({ ...f, wechat: e.target.value }))
                }
              />
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">地址</span>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) =>
                  setForm((f) => ({ ...f, address: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">备注</span>
              <textarea
                rows={3}
                value={form.note}
                onChange={(e) =>
                  setForm((f) => ({ ...f, note: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
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
                {saving ? "保存中…" : editingId ? "保存修改" : "创建供应商"}
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
