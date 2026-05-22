"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CMS_PRODUCT_CATEGORIES_KEY,
  CMS_PRODUCT_CATEGORIES_NAME,
  type CmsProductCategoryItem,
} from "@/lib/cms-product-categories";

type Props = {
  initialCategories: CmsProductCategoryItem[];
  updatedAt: string | null;
};

const EMPTY_FORM = {
  value: "",
  label: "",
  sortOrder: "10",
};

export function CategoryManager({ initialCategories, updatedAt }: Props) {
  const router = useRouter();
  const [categories, setCategories] =
    useState<CmsProductCategoryItem[]>(initialCategories);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(updatedAt);
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
    setEditingValue(null);
  }

  function startEdit(item: CmsProductCategoryItem) {
    setEditingValue(item.value);
    setForm({
      value: item.value,
      label: item.label,
      sortOrder: String(item.sortOrder),
    });
  }

  function handleAddOrUpdate() {
    const value = form.value.trim().toUpperCase();
    const label = form.label.trim();
    const sortOrder = Number(form.sortOrder);

    if (!value || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
      showToast("标识键须为大写英文（如 BOUQUET）", "error");
      return;
    }
    if (!label) {
      showToast("请填写分类名称", "error");
      return;
    }
    if (!Number.isFinite(sortOrder)) {
      showToast("排序权重须为数字", "error");
      return;
    }

    const next: CmsProductCategoryItem = {
      value,
      label,
      sortOrder: Math.round(sortOrder),
    };

    if (editingValue && editingValue !== value) {
      const exists = categories.some((c) => c.value === value);
      if (exists) {
        showToast("该标识键已存在", "error");
        return;
      }
      setCategories((list) =>
        list
          .map((c) => (c.value === editingValue ? next : c))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
    } else if (editingValue) {
      setCategories((list) =>
        list
          .map((c) => (c.value === editingValue ? next : c))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      );
    } else {
      if (categories.some((c) => c.value === value)) {
        showToast("该标识键已存在", "error");
        return;
      }
      setCategories((list) =>
        [...list, next].sort((a, b) => a.sortOrder - b.sortOrder)
      );
    }

    resetForm();
    showToast(editingValue ? "已更新到列表，请保存配置" : "已加入列表，请保存配置", "success");
  }

  function handleRemove(value: string) {
    if (categories.length <= 1) {
      showToast("至少保留一个分类", "error");
      return;
    }
    setCategories((list) => list.filter((c) => c.value !== value));
    if (editingValue === value) resetForm();
  }

  async function handleSave() {
    setSaving(true);
    try {
      const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
      const res = await fetch("/api/admin/app-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: CMS_PRODUCT_CATEGORIES_KEY,
          name: CMS_PRODUCT_CATEGORIES_NAME,
          value: sorted,
        }),
      });

      const json = (await res.json()) as {
        success: boolean;
        error?: string;
        data?: {
          message?: string;
          value?: CmsProductCategoryItem[];
          updatedAt?: string;
        };
      };

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "保存失败");
      }

      if (json.data?.value) {
        setCategories(json.data.value);
      }
      if (json.data?.updatedAt) setLastUpdatedAt(json.data.updatedAt);
      showToast(json.data?.message ?? "分类配置已保存", "success");
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
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
        <h2 className="text-2xl font-semibold text-rose-900">商品分类管理</h2>
        <p className="mt-1 text-sm text-zinc-500">
          动态配置小程序商城分类，商品编辑页将同步使用最新分类
        </p>
        {lastUpdatedAt && (
          <p className="mt-1 text-xs text-zinc-400">
            上次保存：{new Date(lastUpdatedAt).toLocaleString("zh-CN")}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <h3 className="font-semibold text-zinc-900">当前分类列表</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-rose-50/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    分类名称
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    标识键
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    排序
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-600">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {categories.map((item) => (
                  <tr key={item.value} className="hover:bg-zinc-50/80">
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {item.label}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-rose-700">
                      {item.value}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{item.sortOrder}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className="mr-3 text-rose-600 hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(item.value)}
                        className="text-zinc-500 hover:text-red-600"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-zinc-100 px-5 py-4">
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存配置"}
            </Button>
          </div>
        </section>

        <section className="lg:col-span-2 rounded-xl border border-rose-100 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-rose-900">
            {editingValue ? "编辑分类" : "新增分类"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            标识键保存后作为商品多选分类的值，建议使用大写英文
          </p>

          <div className="mt-5 space-y-4">
            <Input
              label="分类名称"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="节日手捧花束"
            />
            <Input
              label="标识键（大写英文）"
              value={form.value}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  value: e.target.value.toUpperCase(),
                }))
              }
              placeholder="BOUQUET"
              disabled={Boolean(editingValue)}
            />
            <Input
              label="排序权重"
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm((f) => ({ ...f, sortOrder: e.target.value }))
              }
              placeholder="10"
            />

            <div className="flex gap-2 pt-2">
              <Button type="button" onClick={handleAddOrUpdate} variant="secondary">
                {editingValue ? "更新到列表" : "加入列表"}
              </Button>
              {editingValue && (
                <Button type="button" variant="ghost" onClick={resetForm}>
                  取消编辑
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
