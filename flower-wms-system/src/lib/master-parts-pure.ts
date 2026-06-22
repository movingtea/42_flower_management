export type MasterPartType = "SUPPLY" | "PACKAGING" | "TOOL" | "OTHER";

export const MASTER_PART_TYPES: MasterPartType[] = [
  "SUPPLY",
  "PACKAGING",
  "TOOL",
  "OTHER",
];

export const DEFAULT_MASTER_PART_TYPE: MasterPartType = "SUPPLY";

export const masterPartTypeLabels: Record<MasterPartType, string> = {
  SUPPLY: "辅料",
  PACKAGING: "包装材料",
  TOOL: "工具",
  OTHER: "其他",
};

export type MasterPartWriteInput = {
  type: MasterPartType;
  name: string;
  spec?: string | null;
  defaultUnit?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  isConsumable?: boolean;
  isActive?: boolean;
  note?: string | null;
};

export type MasterPartDefaults = {
  type: MasterPartType;
  isConsumable: boolean;
  isActive: boolean;
};

export function getDefaultMasterPartValues(): MasterPartDefaults {
  return {
    type: DEFAULT_MASTER_PART_TYPE,
    isConsumable: true,
    isActive: true,
  };
}

export function parseMasterPartType(raw: unknown): MasterPartType {
  if (typeof raw !== "string") {
    throw new Error("请选择物料类型");
  }
  const value = raw.trim().toUpperCase();
  if (!value) {
    throw new Error("请选择物料类型");
  }
  if (!MASTER_PART_TYPES.includes(value as MasterPartType)) {
    throw new Error("物料类型只能为辅料、包装材料、工具或其他");
  }
  return value as MasterPartType;
}

function optionalTrimmedString(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new Error("字段格式不正确");
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("布尔字段格式不正确");
}

export function normalizeMasterPartCreateInput(raw: unknown): MasterPartWriteInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("物料名称不能为空");

  const defaults = getDefaultMasterPartValues();
  return {
    type: parseMasterPartType(body.type ?? defaults.type),
    name,
    spec: optionalTrimmedString(body.spec) ?? null,
    defaultUnit: optionalTrimmedString(body.defaultUnit) ?? null,
    brand: optionalTrimmedString(body.brand) ?? null,
    model: optionalTrimmedString(body.model) ?? null,
    color: optionalTrimmedString(body.color) ?? null,
    isConsumable: parseOptionalBoolean(body.isConsumable) ?? defaults.isConsumable,
    isActive: parseOptionalBoolean(body.isActive) ?? defaults.isActive,
    note: optionalTrimmedString(body.note) ?? null,
  };
}

export function normalizeMasterPartUpdateInput(raw: unknown): MasterPartWriteInput {
  return normalizeMasterPartCreateInput(raw);
}

export function parseMasterPartListParams(searchParams: URLSearchParams) {
  const keyword = searchParams.get("keyword")?.trim() || searchParams.get("q")?.trim() || undefined;
  const typeRaw = searchParams.get("type")?.trim();
  const type = typeRaw ? parseMasterPartType(typeRaw) : undefined;
  const isActiveRaw = searchParams.get("isActive");
  let isActive: boolean | undefined;
  if (isActiveRaw === "true") isActive = true;
  if (isActiveRaw === "false") isActive = false;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get("pageSize") ?? 20) || 20)
  );
  return { keyword, type, isActive, page, pageSize };
}
