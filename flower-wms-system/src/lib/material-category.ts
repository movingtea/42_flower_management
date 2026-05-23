/** WMS 原材料分类（单层扁平） */
export type MaterialCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type MaterialCategoryWriteBody = {
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

export function parseMaterialCategoryWriteBody(
  raw: unknown
): MaterialCategoryWriteBody {
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

  return {
    name,
    description,
    sortOrder: Math.round(sortOrder),
    isActive: b.isActive !== false,
  };
}
