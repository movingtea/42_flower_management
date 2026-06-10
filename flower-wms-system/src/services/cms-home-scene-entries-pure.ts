import {
  GiftOccasionType,
  HomeSceneEntryTargetType,
} from "@/generated/prisma/enums";

export type HomeSceneEntrySource = "CMS" | "FALLBACK";

export type DefaultHomeSceneEntryDef = {
  sceneType: GiftOccasionType;
  title: string;
  subtitle: string;
  iconKey: string;
  sortOrder: number;
  targetType: HomeSceneEntryTargetType;
};

export const CMS_HOME_SCENE_ICON_KEYS = [
  "birthday",
  "anniversary",
  "visit",
  "apology",
  "business",
  "daily-surprise",
  "valentine",
  "qixi",
  "mothers-day",
  "graduation",
  "opening",
  "wedding",
  "gift",
  "heart",
  "calendar",
  "sparkle",
  "flower",
  "custom",
  "fallback",
] as const;

export type CmsHomeSceneIconKey = (typeof CMS_HOME_SCENE_ICON_KEYS)[number];

export const CMS_HOME_SCENE_TYPE_OPTIONS: Array<{
  value: GiftOccasionType;
  label: string;
  defaultIconKey: string;
}> = [
  { value: GiftOccasionType.BIRTHDAY, label: "生日", defaultIconKey: "birthday" },
  {
    value: GiftOccasionType.ANNIVERSARY,
    label: "纪念日",
    defaultIconKey: "anniversary",
  },
  {
    value: GiftOccasionType.VALENTINE,
    label: "情人节",
    defaultIconKey: "valentine",
  },
  { value: GiftOccasionType.QIXI, label: "七夕", defaultIconKey: "qixi" },
  {
    value: GiftOccasionType.MOTHERS_DAY,
    label: "母亲节",
    defaultIconKey: "mothers-day",
  },
  {
    value: GiftOccasionType.GRADUATION,
    label: "毕业",
    defaultIconKey: "graduation",
  },
  { value: GiftOccasionType.VISIT, label: "探望", defaultIconKey: "visit" },
  { value: GiftOccasionType.APOLOGY, label: "道歉", defaultIconKey: "apology" },
  {
    value: GiftOccasionType.BUSINESS,
    label: "商务",
    defaultIconKey: "business",
  },
  { value: GiftOccasionType.OPENING, label: "开业", defaultIconKey: "opening" },
  { value: GiftOccasionType.WEDDING, label: "婚礼", defaultIconKey: "wedding" },
  {
    value: GiftOccasionType.DAILY_SURPRISE,
    label: "日常惊喜",
    defaultIconKey: "daily-surprise",
  },
  { value: GiftOccasionType.OTHER, label: "其他", defaultIconKey: "custom" },
];

export const DEFAULT_HOME_SCENE_ENTRIES: DefaultHomeSceneEntryDef[] = [
  {
    sceneType: GiftOccasionType.BIRTHDAY,
    title: "生日",
    subtitle: "把祝福做成花",
    iconKey: "birthday",
    sortOrder: 10,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
  {
    sceneType: GiftOccasionType.ANNIVERSARY,
    title: "纪念日",
    subtitle: "记住重要的一天",
    iconKey: "anniversary",
    sortOrder: 20,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
  {
    sceneType: GiftOccasionType.VISIT,
    title: "探望",
    subtitle: "带去一份关怀",
    iconKey: "visit",
    sortOrder: 30,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
  {
    sceneType: GiftOccasionType.APOLOGY,
    title: "道歉",
    subtitle: "用花说对不起",
    iconKey: "apology",
    sortOrder: 40,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
  {
    sceneType: GiftOccasionType.BUSINESS,
    title: "商务",
    subtitle: "体面又有温度",
    iconKey: "business",
    sortOrder: 50,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
  {
    sceneType: GiftOccasionType.DAILY_SURPRISE,
    title: "日常惊喜",
    subtitle: "不需要理由",
    iconKey: "daily-surprise",
    sortOrder: 60,
    targetType: HomeSceneEntryTargetType.PRODUCT_FILTER,
  },
];

const SCENE_TYPE_TO_ICON_KEY: Record<string, string> =
  CMS_HOME_SCENE_TYPE_OPTIONS.reduce(
    (acc, item) => {
      acc[item.value] = item.defaultIconKey;
      return acc;
    },
    {} as Record<string, string>
  );

const VALID_ICON_KEYS = new Set<string>(CMS_HOME_SCENE_ICON_KEYS);

export function normalizeTargetType(
  raw?: string | null
): HomeSceneEntryTargetType {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return HomeSceneEntryTargetType.PRODUCT_FILTER;

  if (
    Object.values(HomeSceneEntryTargetType).includes(
      trimmed as HomeSceneEntryTargetType
    )
  ) {
    return trimmed as HomeSceneEntryTargetType;
  }

  const upper = trimmed.toUpperCase();
  if (upper === HomeSceneEntryTargetType.RECOMMENDATION_SLOT) {
    return HomeSceneEntryTargetType.RECOMMENDATION_SLOT;
  }
  if (upper === HomeSceneEntryTargetType.CUSTOM_URL) {
    return HomeSceneEntryTargetType.CUSTOM_URL;
  }
  if (upper === HomeSceneEntryTargetType.PRODUCT_FILTER) {
    return HomeSceneEntryTargetType.PRODUCT_FILTER;
  }

  const aliases: Record<string, HomeSceneEntryTargetType> = {
    product_filter: HomeSceneEntryTargetType.PRODUCT_FILTER,
    FILTER: HomeSceneEntryTargetType.PRODUCT_FILTER,
    商品筛选结果: HomeSceneEntryTargetType.PRODUCT_FILTER,
    recommendation_slot: HomeSceneEntryTargetType.RECOMMENDATION_SLOT,
    推荐位: HomeSceneEntryTargetType.RECOMMENDATION_SLOT,
    custom_url: HomeSceneEntryTargetType.CUSTOM_URL,
    自定义路径: HomeSceneEntryTargetType.CUSTOM_URL,
  };

  return aliases[trimmed] ?? aliases[upper] ?? HomeSceneEntryTargetType.PRODUCT_FILTER;
}

export function sceneTypeToIconKey(sceneType?: string | null): string {
  if (!sceneType?.trim()) return "fallback";
  return SCENE_TYPE_TO_ICON_KEY[sceneType.trim()] ?? "fallback";
}

export function resolveIconKey(
  iconKey?: string | null,
  sceneType?: string | null
): string {
  const trimmed = iconKey?.trim();
  if (trimmed && VALID_ICON_KEYS.has(trimmed)) return trimmed;
  if (trimmed) return "fallback";
  return sceneTypeToIconKey(sceneType);
}

export function sortHomeSceneEntries<T extends { sortOrder: number }>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return 0;
  });
}

export type MiniProgramHomeSceneEntry = {
  id: string;
  title: string;
  subtitle: string | null;
  sceneType: string;
  iconKey: string;
  sortOrder: number;
  targetType: HomeSceneEntryTargetType;
  targetValue: string | null;
  linkedRecommendationSlotKey: string | null;
  linkedRecommendationSlotId: string | null;
  source: HomeSceneEntrySource;
};

export function buildFallbackMiniProgramEntries(): MiniProgramHomeSceneEntry[] {
  return DEFAULT_HOME_SCENE_ENTRIES.map((entry) => ({
    id: `fallback-${entry.sceneType.toLowerCase()}`,
    title: entry.title,
    subtitle: entry.subtitle,
    sceneType: entry.sceneType,
    iconKey: entry.iconKey,
    sortOrder: entry.sortOrder,
    targetType: entry.targetType,
    targetValue: null,
    linkedRecommendationSlotKey: null,
    linkedRecommendationSlotId: null,
    source: "FALLBACK" as const,
  }));
}

export function toMiniProgramHomeSceneEntry(input: {
  id: string;
  title: string;
  subtitle: string | null;
  sceneType: string;
  iconKey: string;
  sortOrder: number;
  targetType: string | null;
  targetValue: string | null;
  linkedRecommendationSlotKey: string | null;
  linkedRecommendationSlotId?: string | null;
  source: HomeSceneEntrySource;
}): MiniProgramHomeSceneEntry {
  const targetType = normalizeTargetType(input.targetType);
  const sceneType = input.sceneType?.trim() ?? "";
  const iconKey = resolveIconKey(input.iconKey, sceneType);

  let targetValue = input.targetValue?.trim() || null;
  if (targetType === HomeSceneEntryTargetType.PRODUCT_FILTER && !targetValue) {
    targetValue = sceneType || null;
  }

  return {
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    sceneType,
    iconKey,
    sortOrder: input.sortOrder,
    targetType,
    targetValue,
    linkedRecommendationSlotKey: input.linkedRecommendationSlotKey,
    linkedRecommendationSlotId: input.linkedRecommendationSlotId ?? null,
    source: input.source,
  };
}

export function getMissingDefaultSceneTypes(
  existingSceneTypes: string[]
): GiftOccasionType[] {
  const existing = new Set(existingSceneTypes.map((s) => s.trim()));
  return DEFAULT_HOME_SCENE_ENTRIES.filter(
    (entry) => !existing.has(entry.sceneType)
  ).map((entry) => entry.sceneType);
}

export function getDefaultEntryDefsForMissingSceneTypes(
  existingSceneTypes: string[]
): DefaultHomeSceneEntryDef[] {
  const missing = new Set(getMissingDefaultSceneTypes(existingSceneTypes));
  return DEFAULT_HOME_SCENE_ENTRIES.filter((entry) =>
    missing.has(entry.sceneType)
  );
}

export const HOME_SCENE_ENTRY_TARGET_TYPE_LABELS: Record<
  HomeSceneEntryTargetType,
  string
> = {
  [HomeSceneEntryTargetType.PRODUCT_FILTER]: "商品筛选结果",
  [HomeSceneEntryTargetType.RECOMMENDATION_SLOT]: "推荐位",
  [HomeSceneEntryTargetType.CUSTOM_URL]: "自定义路径",
};
