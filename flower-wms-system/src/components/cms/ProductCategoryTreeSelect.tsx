"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductCategoryTreeNode } from "@/lib/product-category";

type TreeDataNode = {
  key: string;
  title: string;
  children?: TreeDataNode[];
  disabled?: boolean;
};

function toTreeData(nodes: ProductCategoryTreeNode[]): TreeDataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: node.name,
    disabled: !node.isActive,
    children:
      node.children.length > 0 ? toTreeData(node.children) : undefined,
  }));
}

function flattenTitles(nodes: ProductCategoryTreeNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (list: ProductCategoryTreeNode[]) => {
    for (const n of list) {
      map.set(n.id, n.name);
      walk(n.children);
    }
  };
  walk(nodes);
  return map;
}

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
};

export function ProductCategoryTreeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<ProductCategoryTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/admin/product-categories")
      .then(async (res) => {
        const json = (await res.json()) as {
          success: boolean;
          error?: string;
          data?: { tree?: ProductCategoryTreeNode[] };
        };
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "分类加载失败");
        }
        if (!cancelled) {
          setTree(json.data?.tree ?? []);
          const rootIds = (json.data?.tree ?? []).map((n) => n.id);
          setExpanded(new Set(rootIds));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "分类加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const titleMap = useMemo(() => flattenTitles(tree), [tree]);
  const treeData = useMemo(() => toTreeData(tree), [tree]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelect(id: string, disabled?: boolean) {
    if (disabled) return;
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  function renderNodes(nodes: TreeDataNode[], depth = 0) {
    return nodes.map((node) => {
      const hasChildren = !!node.children?.length;
      const isExpanded = expanded.has(node.key);
      const checked = value.includes(node.key);

      return (
        <div key={node.key}>
          <div
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-rose-50/60"
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleExpand(node.key)}
                className="flex h-5 w-5 shrink-0 items-center justify-center text-xs text-zinc-500"
                aria-label={isExpanded ? "收起" : "展开"}
              >
                {isExpanded ? "▼" : "▶"}
              </button>
            ) : (
              <span className="inline-block w-5 shrink-0" />
            )}
            <label
              className={`flex flex-1 cursor-pointer items-center gap-2 text-sm ${
                node.disabled ? "cursor-not-allowed text-zinc-400" : "text-zinc-800"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={node.disabled}
                onChange={() => toggleSelect(node.key, node.disabled)}
                className="h-4 w-4 accent-rose-600"
              />
              <span>{node.title}</span>
              {node.disabled ? (
                <span className="text-xs text-zinc-400">（已禁用）</span>
              ) : null}
            </label>
          </div>
          {hasChildren && isExpanded ? (
            <div>{renderNodes(node.children!, depth + 1)}</div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-2 block text-sm font-medium text-zinc-700">
        商品分类
      </span>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[42px] w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-700 hover:border-rose-300"
      >
        <span className="truncate">
          {value.length > 0
            ? `已选 ${value.length} 个分类`
            : "请选择商品分类（可多选）"}
        </span>
        <span className="text-zinc-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-2 shadow-lg">
          {loading ? (
            <p className="px-3 py-4 text-center text-sm text-zinc-500">
              正在加载分类…
            </p>
          ) : error ? (
            <p className="px-3 py-4 text-center text-sm text-red-600">{error}</p>
          ) : treeData.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-zinc-500">
              暂无商品分类
            </p>
          ) : (
            renderNodes(treeData)
          )}
        </div>
      )}

      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800"
            >
              {titleMap.get(id) ?? id}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="rounded-full px-1 hover:bg-rose-200"
                aria-label="移除分类"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
