import type { WikiCareRow } from "@/lib/wiki-care";

const WAKE_WATER_DEEP = "需要深水醒花";
const WAKE_WATER_NO_DEEP = "不需要深水醒花";

const MAIN_WATER_DEEP = "深水养护";
const MAIN_WATER_SHALLOW = "浅水养护";

const PRUNE_45 = "45度斜切";
const PRUNE_45_CROSS = "45度斜切 + 十字劈开";
const PRUNE_45_NO_CROSS = "45度斜切，无需十字劈开";

const NUTRIENT_YES = "✓";
const NUTRIENT_NO = "✗";

const DISINFECTANT_NO = "✗";
const DISINFECTANT_DOSES = [
  "✓，1L水加1-2滴",
  "✓，1L水加1滴",
  "✓，2L水加1-2滴",
] as const;

const AI_CARE_FIELD_KEYS = new Set([
  "wakeWater",
  "mainWater",
  "pruneMethod",
  "nutrient",
  "disinfectant",
]);

function compactText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function normalizeWakeWater(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return WAKE_WATER_NO_DEEP;
  if (trimmed === WAKE_WATER_DEEP || trimmed === WAKE_WATER_NO_DEEP) {
    return trimmed;
  }

  const text = compactText(trimmed);
  if (
    containsAny(text, [
      /不需要深水醒花/,
      /无需深水醒花/,
      /不需深水醒花/,
      /不用深水醒花/,
      /不需要深水/,
      /无需深水/,
      /不需深水/,
      /不用深水/,
      /浅[水层]/,
    ])
  ) {
    return WAKE_WATER_NO_DEEP;
  }
  if (containsAny(text, [/需要深水醒花/, /深水醒花/, /深水/])) {
    return WAKE_WATER_DEEP;
  }
  return WAKE_WATER_NO_DEEP;
}

export function normalizeMainWater(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return MAIN_WATER_SHALLOW;
  if (trimmed === MAIN_WATER_DEEP || trimmed === MAIN_WATER_SHALLOW) {
    return trimmed;
  }

  const text = compactText(trimmed);
  if (containsAny(text, [/浅水养护/, /浅水/, /低水位/, /浅养/])) {
    return MAIN_WATER_SHALLOW;
  }
  if (containsAny(text, [/深水养护/, /深水/, /高水位/, /深养/])) {
    return MAIN_WATER_DEEP;
  }
  return MAIN_WATER_SHALLOW;
}

export function normalizePruneMethod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return PRUNE_45;
  if (
    trimmed === PRUNE_45 ||
    trimmed === PRUNE_45_CROSS ||
    trimmed === PRUNE_45_NO_CROSS
  ) {
    return trimmed;
  }

  const text = compactText(trimmed);
  const hasCross = containsAny(text, [
    /十字劈开/,
    /十字切/,
    /十字剪/,
    /可十字/,
    /需十字/,
    /要十字/,
    /建议十字/,
  ]);
  const noCross = containsAny(text, [
    /无需十字/,
    /不需十字/,
    /不需要十字/,
    /不用十字/,
    /勿十字/,
    /禁止十字/,
  ]);

  if (hasCross && !noCross) return PRUNE_45_CROSS;
  if (noCross) return PRUNE_45_NO_CROSS;
  return PRUNE_45;
}

export function normalizeNutrient(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return NUTRIENT_NO;
  if (trimmed === NUTRIENT_YES || trimmed === NUTRIENT_NO) {
    return trimmed;
  }

  const text = compactText(trimmed);
  if (
    trimmed === "✓" ||
    trimmed === "√" ||
    containsAny(text, [/^是$/, /^需要$/, /^要$/])
  ) {
    return NUTRIENT_YES;
  }
  if (
    trimmed === "✗" ||
    trimmed === "×" ||
    trimmed === "x" ||
    trimmed === "X" ||
    containsAny(text, [/^否$/, /^不需要$/, /^无需$/, /^不用$/])
  ) {
    return NUTRIENT_NO;
  }
  if (
    containsAny(text, [
      /不需要添加/,
      /无需添加/,
      /不需添加/,
      /不用添加/,
      /不添加/,
      /不建议添加/,
      /不建议使用/,
      /无需使用/,
      /不需要使用/,
      /不用营养液/,
      /无需营养液/,
    ])
  ) {
    return NUTRIENT_NO;
  }
  if (
    containsAny(text, [
      /建议添加/,
      /需要添加/,
      /可以添加/,
      /添加鲜花营养液/,
      /使用营养液/,
      /营养液/,
      /需要营养液/,
    ])
  ) {
    return NUTRIENT_YES;
  }
  return NUTRIENT_NO;
}

function matchDisinfectantDose(text: string): string | null {
  if (/2\s*L.*1[\-~－至到]?2\s*滴/.test(text) || /2升.*1[\-~－至到]?2\s*滴/.test(text)) {
    return "✓，2L水加1-2滴";
  }
  if (
    /1\s*L.*1\s*滴(?!.*2)/.test(text) ||
    /1升.*1\s*滴(?!.*2)/.test(text) ||
    /每升.*1\s*滴(?!.*2)/.test(text)
  ) {
    return "✓，1L水加1滴";
  }
  if (
    /1\s*L.*1[\-~－至到]?2\s*滴/.test(text) ||
    /1升.*1[\-~－至到]?2\s*滴/.test(text) ||
    /每升.*1[\-~－至到]?2\s*滴/.test(text)
  ) {
    return "✓，1L水加1-2滴";
  }
  return null;
}

export function normalizeDisinfectant(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DISINFECTANT_NO;
  if (trimmed === DISINFECTANT_NO) return DISINFECTANT_NO;
  if ((DISINFECTANT_DOSES as readonly string[]).includes(trimmed)) {
    return trimmed;
  }

  const text = compactText(trimmed);
  if (
    containsAny(text, [
      /不建议使用84/,
      /不建议添加84/,
      /不建议使用消毒液/,
      /不建议添加消毒液/,
      /不需要添加84/,
      /无需添加84/,
      /不需添加84/,
      /不用添加84/,
      /不添加84/,
      /不需要84/,
      /无需84/,
      /不用84/,
      /不使用84/,
      /无需使用84/,
      /不需要使用84/,
      /^✗$/,
      /^×$/,
      /^x$/i,
    ])
  ) {
    return DISINFECTANT_NO;
  }

  const dose = matchDisinfectantDose(text);
  if (dose) return dose;

  if (
    containsAny(text, [
      /84消毒液/,
      /84消毒/,
      /消毒液/,
      /可按/,
      /建议添加/,
      /需要添加/,
      /可以添加/,
      /添加84/,
      /使用84/,
      /^✓/,
      /^√/,
      /滴/,
    ])
  ) {
    return "✓，1L水加1-2滴";
  }

  return DISINFECTANT_NO;
}

export function normalizeAiCareFieldValue(key: string, value: string): string {
  switch (key) {
    case "wakeWater":
      return normalizeWakeWater(value);
    case "mainWater":
      return normalizeMainWater(value);
    case "pruneMethod":
      return normalizePruneMethod(value);
    case "nutrient":
      return normalizeNutrient(value);
    case "disinfectant":
      return normalizeDisinfectant(value);
    default:
      return value.trim();
  }
}

export function normalizeAiCareTable(careTable: WikiCareRow[]): WikiCareRow[] {
  return careTable.map((row) => {
    if (!AI_CARE_FIELD_KEYS.has(row.key)) {
      return { ...row, value: row.value.trim() };
    }
    return {
      ...row,
      value: normalizeAiCareFieldValue(row.key, row.value),
    };
  });
}
