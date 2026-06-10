/** CMS 配置 key 格式：小写字母、数字、下划线、短横线 */
export const CMS_KEY_PATTERN = /^[a-z0-9_-]+$/;

export function validateCmsKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return "key 不能为空";
  if (!CMS_KEY_PATTERN.test(trimmed)) {
    return "key 只能包含小写字母、数字、下划线和短横线";
  }
  return null;
}

const SLOT_TYPE_KEY_BASE: Record<string, string> = {
  HOME_MAIN: "home_main",
  HOME_SECONDARY: "home_secondary",
  SCENE: "scene",
  FESTIVAL: "festival",
  NEW_ARRIVAL: "new_arrival",
  HIGH_TICKET: "high_ticket",
  CUSTOM: "custom",
};

function sceneTypeToSlug(sceneType: string): string {
  return sceneType.trim().toLowerCase();
}

function nameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** 根据推荐位类型与场景自动生成 key */
export function generateRecommendationSlotKey(params: {
  slotType: string;
  sceneType?: string | null;
  name?: string;
}): string {
  const { slotType, sceneType, name } = params;

  if (slotType === "SCENE" && sceneType?.trim()) {
    return `scene_${sceneTypeToSlug(sceneType)}`;
  }

  const base = SLOT_TYPE_KEY_BASE[slotType];
  if (base) return base;

  if (name?.trim()) {
    const slug = nameToSlug(name);
    if (slug) return slug;
  }

  return "custom";
}

/** 营销模块 key 自动生成 */
export function generateMarketingConfigKey(params: {
  moduleType: string;
  name?: string;
}): string {
  const typeSlug = params.moduleType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (params.name?.trim()) {
    const nameSlug = nameToSlug(params.name);
    if (nameSlug) return `${typeSlug}_${nameSlug}`;
  }
  return typeSlug || "marketing_config";
}

export async function ensureUniqueCmsKey(
  key: string,
  isTaken: (k: string) => Promise<boolean>,
  excludeKey?: string | null
): Promise<string> {
  const base = key.trim();
  if (!base) return base;

  if (excludeKey && base === excludeKey.trim()) return base;
  if (!(await isTaken(base))) return base;

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}_${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  return `${base}_${Date.now()}`;
}
