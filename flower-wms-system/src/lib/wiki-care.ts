/** 结构化养护指南行（与 DeepSeek / 前端表格一致） */
export type WikiCareRow = {
  key: string;
  label: string;
  value: string;
};

export type WikiCareDocument = {
  v: 1;
  careTable: WikiCareRow[];
};

export const WIKI_CARE_ROW_SPECS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "wakeWater", label: "醒花水位" },
  { key: "mainWater", label: "养护水位" },
  { key: "pruneMethod", label: "剪根方法" },
  { key: "nutrient", label: "鲜花营养液" },
  { key: "disinfectant", label: "84消毒液" },
  { key: "frequency", label: "换水频率" },
  { key: "notes", label: "注意事项" },
];

export type FlowerAiCompleteResult = {
  latinName: string;
  englishName: string;
  careTable: WikiCareRow[];
};

export function emptyCareTable(): WikiCareRow[] {
  return WIKI_CARE_ROW_SPECS.map((row) => ({
    key: row.key,
    label: row.label,
    value: "",
  }));
}

export function careTableToMaintenanceText(careTable: WikiCareRow[]): string {
  return careTable
    .filter((row) => row.value.trim())
    .map((row) => `${row.label}：${row.value.trim()}`)
    .join("\n");
}

export function formatWikiEnglishName(
  latinName: string,
  englishName: string
): string {
  const latin = latinName.trim();
  const english = englishName.trim();
  if (latin && english && latin.toLowerCase() !== english.toLowerCase()) {
    return `${latin} / ${english}`;
  }
  return latin || english;
}

export function parseCareTable(raw: unknown): WikiCareRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: WikiCareRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const value = typeof row.value === "string" ? row.value.trim() : "";
    if (!key && !label) continue;
    rows.push({
      key: key || label,
      label: label || key,
      value,
    });
  }
  return rows.length > 0 ? rows : null;
}

export function normalizeCareTable(rows: WikiCareRow[]): WikiCareRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return WIKI_CARE_ROW_SPECS.map((spec) => {
    const existing = byKey.get(spec.key);
    return {
      key: spec.key,
      label: spec.label,
      value: existing?.value?.trim() ?? "",
    };
  });
}

export function parseStoredCareDocument(
  maintenanceCare: unknown
): WikiCareRow[] | null {
  if (!maintenanceCare || typeof maintenanceCare !== "object") return null;
  const doc = maintenanceCare as Record<string, unknown>;
  if (Array.isArray(doc.careTable)) {
    const parsed = parseCareTable(doc.careTable);
    return parsed ? normalizeCareTable(parsed) : null;
  }
  if (Array.isArray(maintenanceCare)) {
    const parsed = parseCareTable(maintenanceCare);
    return parsed ? normalizeCareTable(parsed) : null;
  }
  return null;
}

export function buildCareDocument(careTable: WikiCareRow[]): WikiCareDocument {
  return { v: 1, careTable: normalizeCareTable(careTable) };
}

export function validateCareTableForSave(careTable: WikiCareRow[]): boolean {
  return normalizeCareTable(careTable).some((row) => row.value.trim().length > 0);
}

export function parseFlowerAiJson(raw: string): FlowerAiCompleteResult {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  const data = JSON.parse(trimmed) as Record<string, unknown>;
  const latinName =
    typeof data.latinName === "string" ? data.latinName.trim() : "";
  const englishName =
    typeof data.englishName === "string" ? data.englishName.trim() : "";
  const careTableRaw = parseCareTable(data.careTable);
  if (!latinName && !englishName) {
    throw new Error("AI 未返回有效的拉丁学名或英文名");
  }
  if (!careTableRaw || !validateCareTableForSave(careTableRaw)) {
    throw new Error("AI 未返回有效的养护指南表格");
  }
  return {
    latinName,
    englishName,
    careTable: normalizeCareTable(careTableRaw),
  };
}
