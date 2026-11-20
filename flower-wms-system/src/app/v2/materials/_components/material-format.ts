import type { MaterialKnowledgeEditorValue } from "../MaterialKnowledgeEditor";
import type { DecimalLike, MaterialRow } from "./material-types";

export const KIND_LABEL: Record<string, string> = { FLOWER: "花材", FOLIAGE: "叶材", PACKAGING: "包装", CONSUMABLE: "耗材", OTHER: "其他" };
export const FLORAL_ROLE_LABEL: Record<string, string> = { MAIN: "主花", FILLER: "配花", LINE: "线状花", FOLIAGE: "叶材" };
export const LOSS_MODE_LABEL: Record<string, string> = { OPTIMISTIC: "乐观", STANDARD: "标准", CONSERVATIVE: "保守" };

export function decimalText(value: DecimalLike): string | null {
  if (value == null) return null;
  const text = typeof value === "string" ? value : value.toString();
  return text.trim() || null;
}

export function formatPercent(value: DecimalLike): string {
  const raw = decimalText(value);
  if (raw === null) return "未设置";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "未设置";
  return `${Number((parsed * 100).toFixed(2))}%`;
}

export function formatMoney(item: Pick<MaterialRow, "standardUnitCost" | "costUnit">): string {
  const raw = decimalText(item.standardUnitCost);
  if (raw === null) return "未设置";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "未设置";
  return `¥${parsed.toFixed(2)} / ${item.costUnit || "支"}`;
}

/** Stored 0–1 rate → the 0–100 percentage text the form edits. */
export function ratePercentText(value: DecimalLike): string {
  const raw = decimalText(value);
  if (raw === null) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "";
  return String(Number((parsed * 100).toFixed(4)));
}

/** `{ zh: [...] }` → comma separated text for the single aliases input. */
export function aliasListText(aliasMap: unknown): string {
  if (!aliasMap || typeof aliasMap !== "object" || Array.isArray(aliasMap)) return "";
  const aliases: string[] = [];
  for (const entry of Object.values(aliasMap as Record<string, unknown>)) {
    if (!Array.isArray(entry)) continue;
    for (const alias of entry) {
      if (typeof alias !== "string") continue;
      const trimmed = alias.trim();
      if (trimmed && !aliases.includes(trimmed)) aliases.push(trimmed);
    }
  }
  return aliases.join("，");
}

export function toKnowledgeValue(item: MaterialRow): MaterialKnowledgeEditorValue {
  return {
    englishName: item.englishName,
    flowerLanguage: item.flowerLanguage,
    maintenance: item.maintenance,
    maintenanceCare: item.maintenanceCare,
    supplySeason: item.supplySeason,
    defaultShelfLifeDays: item.defaultShelfLifeDays,
    standardUnitCost: decimalText(item.standardUnitCost),
    costUnit: item.costUnit,
    costNote: item.costNote,
    optimisticUsableRate: decimalText(item.optimisticUsableRate),
    standardUsableRate: decimalText(item.standardUsableRate),
    conservativeUsableRate: decimalText(item.conservativeUsableRate),
    lossRateNote: item.lossRateNote,
    brand: item.brand,
    model: item.model,
    notes: item.notes,
    imageKey: item.imageKey,
    safetyStockThreshold: decimalText(item.safetyStockThreshold),
    categoryIds: item.categories.map((relation) => relation.categoryId),
  };
}
