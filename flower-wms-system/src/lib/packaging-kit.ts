export type PackagingKitRow = {
  id: string;
  name: string;
  description: string | null;
  standardCost: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PackagingKitWriteBody = {
  name: string;
  description: string | null;
  standardCost: string;
  isActive: boolean;
};

export function parsePackagingKitWriteBody(
  raw: unknown
): PackagingKitWriteBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }

  const b = raw as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new Error("包装方案名称不能为空");

  const cost = Number(b.standardCost);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("标准成本须为非负数字");
  }

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : null;

  return {
    name,
    description,
    standardCost: cost.toFixed(2),
    isActive: b.isActive !== false,
  };
}
