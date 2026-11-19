import type { MaterialKind } from "@/generated/prisma-v2/client";
import {
  buildCareDocument,
  careTableToMaintenanceText,
  normalizeCareTable,
  parseCareTable,
  validateCareTableForSave,
  type WikiCareRow,
} from "@/lib/wiki-care";
import type { MaterialInput } from "@/v2/services/master-data";

/**
 * Minimal FormData surface used by the material form parser. Keeping the parser
 * on this interface makes it testable in plain Node without a DOM.
 */
export type MaterialFormReader = Pick<FormData, "get" | "getAll">;

const RATE_FIELDS = [
  { key: "optimisticUsableRate", label: "乐观可用率" },
  { key: "standardUsableRate", label: "标准可用率" },
  { key: "conservativeUsableRate", label: "保守可用率" },
] as const;

const DEFAULT_RATE_FIELDS = [
  { key: "defaultUsableRate", label: "默认可用率" },
  { key: "defaultLossRate", label: "默认损耗率" },
] as const;

const LOSS_MODE_FALLBACK = "STANDARD";
/** Chinese and English list separators accepted by multi-value material fields. */
const LIST_SEPARATOR = /[,，、;；\n]+/;

function text(data: MaterialFormReader, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function optionalText(data: MaterialFormReader, key: string): string | null {
  return text(data, key).trim() || null;
}

/** Parse a UI percentage (0–100) and store it as a 0–1 rate. */
function parsePercent(data: MaterialFormReader, key: string, label: string): number | null {
  const raw = text(data, key).trim();
  if (!raw) return null;
  const numeric = raw.endsWith("%") ? raw.slice(0, -1).trim() : raw;
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须为 0–100 的百分比`);
  if (parsed < 0 || parsed > 100) throw new Error(`${label}必须在 0–100 之间`);
  return Number((parsed / 100).toFixed(4));
}

/**
 * Read the hidden careTable JSON. Malformed JSON and non-array payloads are
 * rejected; an empty array (or all-blank rows) means "no structured table".
 */
function parseCareTableField(data: MaterialFormReader): WikiCareRow[] | null {
  const raw = text(data, "careTable").trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("养护指南表格格式无效");
  }
  if (!Array.isArray(parsed)) throw new Error("养护指南表格格式无效");
  if (parsed.length === 0) return null;

  const rows = parseCareTable(parsed);
  if (!rows) throw new Error("养护指南表格格式无效");
  return normalizeCareTable(rows);
}

function parseCategoryIds(data: MaterialFormReader): string[] {
  const ids = data
    .getAll("categoryIds")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Trim and de-duplicate comma/、/; separated text; blank entries are dropped. */
function parseListValues(raw: string): string[] {
  const values: string[] = [];
  for (const entry of raw.split(LIST_SEPARATOR)) {
    const value = entry.trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * Aliases are edited as comma-separated text and stored as `{ zh: [...] }`.
 * An advanced caller may submit the hidden `aliasMap` JSON instead; malformed
 * JSON is rejected exactly like the care-table field.
 */
function parseAliasMap(data: MaterialFormReader): Record<string, string[]> | null {
  const rawJson = text(data, "aliasMap").trim();
  if (rawJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("别名数据格式无效");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("别名数据格式无效");
    }
    return parsed as Record<string, string[]>;
  }
  const aliases = parseListValues(text(data, "aliases"));
  return aliases.length > 0 ? { zh: aliases } : null;
}

/**
 * Map the material form (create or edit) onto the V2 service input.
 * Percent rates are entered as 0–100 and converted to 0–1 here; blank optional
 * values become null/empty so an edit can clear a previously stored value.
 * The code field is no longer rendered: a blank value lets the service generate
 * `MAT-YYYYMMDD-XXXXXXXX`, while an explicitly submitted code is kept for
 * imports and tests.
 */
export function parseMaterialForm(data: MaterialFormReader): MaterialInput {
  const careTable = parseCareTableField(data);
  const hasCareTable = careTable ? validateCareTableForSave(careTable) : false;
  const maintenanceText = optionalText(data, "maintenance");
  const maintenance =
    maintenanceText ??
    (hasCareTable && careTable ? careTableToMaintenanceText(careTable) : null);

  return {
    code: text(data, "code").trim() || undefined,
    name: text(data, "name"),
    kind: text(data, "kind") as MaterialKind,
    color: optionalText(data, "color"),
    floralRole: optionalText(data, "floralRole"),
    colorTags: parseListValues(text(data, "colorTags")),
    morphology: optionalText(data, "morphology"),
    aliasMap: parseAliasMap(data),
    grade: optionalText(data, "grade"),
    gradeSpecification: optionalText(data, "gradeSpecification"),
    specification: optionalText(data, "specification"),
    baseUnit: text(data, "baseUnit"),
    quantityScale: Number(text(data, "quantityScale") || "0"),
    reservePerOrder: data.get("reservePerOrder") !== null,
    englishName: optionalText(data, "englishName"),
    flowerLanguage: optionalText(data, "flowerLanguage"),
    maintenance,
    maintenanceCare:
      hasCareTable && careTable ? buildCareDocument(careTable) : null,
    supplySeason: optionalText(data, "supplySeason"),
    defaultShelfLifeDays: optionalText(data, "defaultShelfLifeDays"),
    standardUnitCost: optionalText(data, "standardUnitCost"),
    costUnit: optionalText(data, "costUnit"),
    costNote: optionalText(data, "costNote"),
    optimisticUsableRate: parsePercent(data, RATE_FIELDS[0].key, RATE_FIELDS[0].label),
    standardUsableRate: parsePercent(data, RATE_FIELDS[1].key, RATE_FIELDS[1].label),
    conservativeUsableRate: parsePercent(data, RATE_FIELDS[2].key, RATE_FIELDS[2].label),
    defaultUsableRate: parsePercent(data, DEFAULT_RATE_FIELDS[0].key, DEFAULT_RATE_FIELDS[0].label),
    defaultLossRate: parsePercent(data, DEFAULT_RATE_FIELDS[1].key, DEFAULT_RATE_FIELDS[1].label),
    lossMode: optionalText(data, "lossMode") ?? LOSS_MODE_FALLBACK,
    lossRateNote: optionalText(data, "lossRateNote"),
    brand: optionalText(data, "brand"),
    model: optionalText(data, "model"),
    notes: optionalText(data, "notes"),
    imageKey: optionalText(data, "imageKey"),
    safetyStockThreshold: optionalText(data, "safetyStockThreshold"),
    categoryIds: parseCategoryIds(data),
  };
}
