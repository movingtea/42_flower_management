/**
 * 首页场景入口 — API 拉取、本地 fallback、跳转适配
 */
import {
  getIconByKey,
  getSceneIcon,
  HOME_SCENE_ENTRIES_FALLBACK,
  type HomeSceneEntryDisplay,
} from './icons';

export type HomeSceneEntryApiItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  sceneType: string;
  iconKey?: string | null;
  sortOrder?: number;
  targetType?: string | null;
  targetValue?: string | null;
  linkedRecommendationSlotKey?: string | null;
  source?: string;
};

export type HomeSceneEntriesResponse = {
  entries?: HomeSceneEntryApiItem[];
  source?: string;
};

const TARGET_PRODUCT_FILTER = 'PRODUCT_FILTER';
const TARGET_RECOMMENDATION_SLOT = 'RECOMMENDATION_SLOT';
const TARGET_CUSTOM_URL = 'CUSTOM_URL';

/** 本地 fallback（API 失败或空数组时使用） */
export function getLocalFallbackSceneEntries(): HomeSceneEntryDisplay[] {
  return HOME_SCENE_ENTRIES_FALLBACK.map((entry) => ({
    ...entry,
    icon: getSceneIcon(entry.sceneType),
  }));
}

/** 将 API 条目转为首页展示结构 */
export function mapApiSceneEntries(
  items: HomeSceneEntryApiItem[]
): HomeSceneEntryDisplay[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle ?? '',
    sceneType: item.sceneType,
    iconKey: item.iconKey ?? '',
    icon: getIconByKey(item.iconKey, item.sceneType),
    sortOrder: item.sortOrder ?? 0,
    targetType: normalizeTargetType(item.targetType),
    targetValue: item.targetValue ?? '',
    linkedRecommendationSlotKey: item.linkedRecommendationSlotKey ?? '',
    source: item.source ?? 'CMS',
  }));
}

function normalizeTargetType(raw?: string | null): string {
  if (raw === TARGET_RECOMMENDATION_SLOT) return TARGET_RECOMMENDATION_SLOT;
  if (raw === TARGET_CUSTOM_URL) return TARGET_CUSTOM_URL;
  return TARGET_PRODUCT_FILTER;
}

/** 构建场景入口跳转 URL */
export function buildSceneEntryNavigateUrl(entry: {
  sceneType?: string;
  targetType?: string;
  targetValue?: string;
  linkedRecommendationSlotKey?: string;
}): string {
  const targetType = normalizeTargetType(entry.targetType);
  const sceneType = (entry.sceneType ?? '').trim();

  if (targetType === TARGET_CUSTOM_URL) {
    const path = (entry.targetValue ?? '').trim();
    if (path) return path.startsWith('/') ? path : `/${path}`;
  }

  if (targetType === TARGET_RECOMMENDATION_SLOT) {
    const slotKey = (entry.linkedRecommendationSlotKey ?? entry.targetValue ?? '').trim();
    const params = new URLSearchParams();
    params.set('filterMode', '1');
    if (sceneType) params.set('sceneType', sceneType);
    if (slotKey) params.set('slotKey', slotKey);
    return `/pages/category/category?${params.toString()}`;
  }

  const occasion = (entry.targetValue ?? sceneType).trim();
  if (!occasion) {
    return '/pages/category/category';
  }
  return `/pages/category/category?sceneType=${encodeURIComponent(occasion)}&filterMode=1&occasionTag=${encodeURIComponent(occasion)}`;
}

/** 导航到场景入口目标页 */
export function navigateToSceneEntry(entry: {
  sceneType?: string;
  targetType?: string;
  targetValue?: string;
  linkedRecommendationSlotKey?: string;
}): void {
  const url = buildSceneEntryNavigateUrl(entry);
  wx.navigateTo({
    url,
    fail: () => {
      wx.showToast({ title: '场景页暂未开放', icon: 'none' });
    },
  });
}
