/** 商品分类树节点（CMS / 小程序） */
export type ProductCategoryTreeNode = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isActive: boolean;
  imageUrl: string | null;
  children: ProductCategoryTreeNode[];
};

export type ProductCategoryFlatRow = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isActive: boolean;
  imageUrl: string | null;
};

export type ProductCategoryWriteBody = {
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isActive: boolean;
  imageUrl: string | null;
};

export function normalizeParentId(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

export function parseProductCategoryWriteBody(raw: unknown): ProductCategoryWriteBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("分类名称不能为空");

  const sortOrder = Number(b.sortOrder ?? 0);
  if (!Number.isFinite(sortOrder)) {
    throw new Error("排序权重须为数字");
  }

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : null;

  let imageUrl: string | null = null;
  if (typeof b.imageUrl === "string") {
    const url = b.imageUrl.trim();
    imageUrl = url.length > 0 ? url : null;
  }

  return {
    name,
    description,
    sortOrder: Math.round(sortOrder),
    parentId: normalizeParentId(b.parentId),
    isActive: b.isActive !== false,
    imageUrl,
  };
}

export function buildProductCategoryTree(
  rows: ProductCategoryFlatRow[]
): ProductCategoryTreeNode[] {
  const map = new Map<string, ProductCategoryTreeNode>();

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }

  const roots: ProductCategoryTreeNode[] = [];

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else if (!node.parentId) {
      roots.push(node);
    }
  }

  const sortNodes = (list: ProductCategoryTreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
    for (const n of list) sortNodes(n.children);
  };

  sortNodes(roots);
  return roots;
}

export function collectProductCategoryDescendantIds(
  categoryId: string,
  rows: { id: string; parentId: string | null }[]
): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r.id);
    byParent.set(r.parentId, list);
  }

  const out = new Set<string>([categoryId]);
  const stack = [categoryId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const kids = byParent.get(current) ?? [];
    for (const kid of kids) {
      if (!out.has(kid)) {
        out.add(kid);
        stack.push(kid);
      }
    }
  }

  return out;
}

export function flattenProductCategoryOptions(
  rows: ProductCategoryFlatRow[],
  options?: { activeOnly?: boolean }
): Array<{
  id: string;
  label: string;
  sortOrder: number;
  parentId: string | null;
  depth: number;
}> {
  const tree = buildProductCategoryTree(
    options?.activeOnly ? rows.filter((r) => r.isActive) : rows
  );
  const out: Array<{
    id: string;
    label: string;
    sortOrder: number;
    parentId: string | null;
    depth: number;
  }> = [];

  const walk = (nodes: ProductCategoryTreeNode[], depth: number) => {
    for (const n of nodes) {
      const prefix = depth > 0 ? `${"　".repeat(depth)}└ ` : "";
      out.push({
        id: n.id,
        label: `${prefix}${n.name}`,
        sortOrder: n.sortOrder,
        parentId: n.parentId,
        depth,
      });
      walk(n.children, depth + 1);
    }
  };

  walk(tree, 0);
  return out;
}
