"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/Switch";
import type { ProductCategoryTreeNode } from "@/lib/product-category";
import { collectProductCategoryDescendantIds } from "@/lib/product-category";

type Props = {
  initialTree: ProductCategoryTreeNode[];
};

type FormState = {
  name: string;
  description: string;
  sortOrder: string;
  parentId: string;
  isActive: boolean;
  imageUrl: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  sortOrder: "10",
  parentId: "",
  isActive: true,
  imageUrl: "",
};

function flattenTree(nodes: ProductCategoryTreeNode[]): ProductCategoryTreeNode[] {
  const out: ProductCategoryTreeNode[] = [];
  const walk = (list: ProductCategoryTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function TreeRows({
  nodes,
  depth,
  onEdit,
  onDelete,
}: {
  nodes: ProductCategoryTreeNode[];
  depth: number;
  onEdit: (node: ProductCategoryTreeNode) => void;
  onDelete: (node: ProductCategoryTreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <Fragment key={node.id}>
          <tr className="hover:bg-zinc-50/80">
            <td className="px-4 py-3">
              <span
                className="font-medium text-zinc-900"
                style={{ paddingLeft: depth * 20 }}
              >
                {depth > 0 ? "└ " : ""}
                {node.name}
              </span>
            </td>
            <td className="px-4 py-3 text-zinc-600">{node.sortOrder}</td>
            <td className="px-4 py-3">
              {node.isActive ? (
                <Badge variant="success">已启用</Badge>
              ) : (
                <Badge variant="default">已禁用</Badge>
              )}
            </td>
            <td className="px-4 py-3 max-w-[180px] truncate text-zinc-500">
              {node.imageUrl || "—"}
            </td>
            <td className="px-4 py-3">
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="mr-3 text-rose-600 hover:underline"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => onDelete(node)}
                className="text-zinc-500 hover:text-red-600"
              >
                删除
              </button>
            </td>
          </tr>
          {node.children.length > 0 && (
            <TreeRows
              nodes={node.children}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}
        </Fragment>
      ))}
    </>
  );
}

export function ProductCategoryManager({ initialTree }: Props) {
  const router = useRouter();
  const [tree, setTree] = useState(initialTree);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const flat = useMemo(() => flattenTree(tree), [tree]);

  const parentOptions = useMemo(() => {
    const exclude = new Set<string>();
    if (editingId) {
      const rows = flat.map((n) => ({ id: n.id, parentId: n.parentId }));
      for (const id of collectProductCategoryDescendantIds(editingId, rows)) {
        exclude.add(id);
      }
    }
    return flat.filter((n) => !exclude.has(n.id));
  }, [flat, editingId]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2800);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(node: ProductCategoryTreeNode) {
    setEditingId(node.id);
    setForm({
      name: node.name,
      description: node.description ?? "",
      sortOrder: String(node.sortOrder),
      parentId: node.parentId ?? "",
      isActive: node.isActive,
      imageUrl: node.imageUrl ?? "",
    });
  }

  async function reloadTree() {
    const res = await fetch("/api/admin/product-categories");
    const json = (await res.json()) as {
      success: boolean;
      data?: { tree?: ProductCategoryTreeNode[] };
    };
    if (res.ok && json.success && json.data?.tree) {
      setTree(json.data.tree);
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
      parentId: form.parentId.trim() || null,
      isActive: form.isActive,
      imageUrl: form.imageUrl.trim() || null,
    };

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/product-categories/${editingId}`
        : "/api/admin/product-categories";
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
      await reloadTree();
      router.refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(node: ProductCategoryTreeNode) {
    if (!window.confirm(`确定删除商品分类「${node.name}」？子分类将一并删除。`)) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/product-categories/${node.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as {
        success: boolean;
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "删除失败");
      }
      showToast("已删除", "success");
      if (editingId === node.id) resetForm();
      await reloadTree();
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
        <h2 className="text-2xl font-semibold text-rose-900">商品分类管理</h2>
        <p className="mt-1 text-sm text-zinc-500">
          商城商品专用分类树，支持二级及以上父子结构；与 WMS 原材料分类完全独立。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3 rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <h3 className="font-semibold text-zinc-900">商品分类树</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-rose-50/50">
                <tr>
                  <th className="px-4 py-3 font-medium text-zinc-600">分类名称</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">排序权重</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">分类图片</th>
                  <th className="px-4 py-3 font-medium text-zinc-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tree.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-zinc-500">
                      暂无商品分类
                    </td>
                  </tr>
                ) : (
                  <TreeRows
                    nodes={tree}
                    depth={0}
                    onEdit={startEdit}
                    onDelete={handleDelete}
                  />
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-2 rounded-xl border border-rose-100 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-rose-900">
            {editingId ? "编辑商品分类" : "新建商品分类"}
          </h3>

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
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700">上级商品分类</span>
              <select
                value={form.parentId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, parentId: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              >
                <option value="">无（一级分类）</option>
                {parentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.parentId ? `　└ ${opt.name}` : opt.name}
                  </option>
                ))}
              </select>
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
            <Input
              label="分类图片 URL"
              value={form.imageUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, imageUrl: e.target.value }))
              }
            />
            <div className="flex gap-2 pt-2">
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
