"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductCategoryTreeNode } from "@/lib/product-category";

type Props = {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  disabled?: boolean;
  label?: string;
  allowClear?: boolean;
};

function flattenCategories(
  nodes: ProductCategoryTreeNode[],
  depth = 0
): Array<{ id: string; name: string; depth: number; isActive: boolean }> {
  const result: Array<{
    id: string;
    name: string;
    depth: number;
    isActive: boolean;
  }> = [];
  for (const node of nodes) {
    result.push({
      id: node.id,
      name: node.name,
      depth,
      isActive: node.isActive,
    });
    if (node.children.length > 0) {
      result.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return result;
}

export function CategoryPicker({
  value,
  onChange,
  disabled,
  label = "选择分类",
  allowClear = true,
}: Props) {
  const [tree, setTree] = useState<ProductCategoryTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/product-categories");
        const json = (await res.json()) as {
          success?: boolean;
          error?: string;
          data?: { tree?: ProductCategoryTreeNode[] };
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "分类加载失败");
        }
        if (!cancelled) setTree(json.data?.tree ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "分类加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flat = useMemo(() => flattenCategories(tree), [tree]);
  const selected = flat.find((c) => c.id === value);
  const missing = value && !loading && !selected;

  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2"
      >
        {allowClear ? <option value="">不选择分类</option> : null}
        {flat.map((cat) => (
          <option key={cat.id} value={cat.id} disabled={!cat.isActive}>
            {"　".repeat(cat.depth)}
            {cat.name}
            {!cat.isActive ? "（已停用）" : ""}
          </option>
        ))}
      </select>
      {loading ? <p className="text-xs text-zinc-400">加载分类中…</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {missing ? (
        <p className="text-xs text-amber-700">关联分类不存在或已删除</p>
      ) : null}
    </label>
  );
}
