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
  linkedRecommendationSlotId?: string | null;
  source?: string;
};

export type HomeSceneEntriesResponse = {
  entries?: HomeSceneEntryApiItem[];
  source?: string;
};

export type HomeSceneEntryNavigateInput = {
  sceneType?: string;
  targetType?: string;
  targetValue?: string;
  linkedRecommendationSlotKey?: string;
};

export type CategoryPendingNav = {
  sceneType?: string;
  occasionTag?: string;
  filterMode?: boolean;
  slotKey?: string;
};

/** switchTab 无法带 query，选花 tab 的筛选参数经此 key 暂存 */
export const CATEGORY_PENDING_NAV_KEY = 'category_pending_nav';

const TARGET_PRODUCT_FILTER = 'PRODUCT_FILTER';
const TARGET_RECOMMENDATION_SLOT = 'RECOMMENDATION_SLOT';
const TARGET_CUSTOM_URL = 'CUSTOM_URL';

const CATEGORY_TAB_PATH = '/pages/category/category';

/** 与 app.json tabBar.list 保持一致 */
const TAB_BAR_PAGE_PATHS = new Set([
  '/pages/index/index',
  CATEGORY_TAB_PATH,
  '/pages/cart/cart',
  '/pages/mine/mine',
]);

const TARGET_TYPE_ALIASES: Record<string, string> = {
  PRODUCT_FILTER: TARGET_PRODUCT_FILTER,
  product_filter: TARGET_PRODUCT_FILTER,
  FILTER: TARGET_PRODUCT_FILTER,
  商品筛选结果: TARGET_PRODUCT_FILTER,
  RECOMMENDATION_SLOT: TARGET_RECOMMENDATION_SLOT,
  recommendation_slot: TARGET_RECOMMENDATION_SLOT,
  推荐位: TARGET_RECOMMENDATION_SLOT,
  CUSTOM_URL: TARGET_CUSTOM_URL,
  custom_url: TARGET_CUSTOM_URL,
  自定义路径: TARGET_CUSTOM_URL,
};

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

/** 兼容 CMS / 旧数据的 targetType 写法 */
export function normalizeTargetType(raw?: string | null): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return TARGET_PRODUCT_FILTER;

  const upper = trimmed.toUpperCase();
  if (upper === TARGET_RECOMMENDATION_SLOT) return TARGET_RECOMMENDATION_SLOT;
  if (upper === TARGET_CUSTOM_URL) return TARGET_CUSTOM_URL;
  if (upper === TARGET_PRODUCT_FILTER) return TARGET_PRODUCT_FILTER;

  return TARGET_TYPE_ALIASES[trimmed] ?? TARGET_TYPE_ALIASES[upper] ?? TARGET_PRODUCT_FILTER;
}

export function isTabBarPage(path: string): boolean {
  const normalized = normalizePagePath(path);
  return TAB_BAR_PAGE_PATHS.has(normalized);
}

function normalizePagePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

function parseMiniProgramPath(raw: string): {
  path: string;
  query: Record<string, string>;
} {
  const full = normalizePagePath(raw);
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) {
    return { path: full, query: {} };
  }

  const path = normalizePagePath(raw.slice(0, qIndex));
  const search = raw.slice(qIndex + 1);
  const query: Record<string, string> = {};

  for (const part of search.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const value = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : '');
    if (key) query[key] = value;
  }

  return { path, query };
}

export function setCategoryPendingNav(payload: CategoryPendingNav): void {
  try {
    wx.setStorageSync(CATEGORY_PENDING_NAV_KEY, payload);
  } catch (err) {
    console.error('[home-scene] setCategoryPendingNav failed', err);
  }
}

/** 读取并清除选花页 pending 导航参数（switchTab 场景） */
export function consumeCategoryPendingNav(): CategoryPendingNav | null {
  try {
    const raw = wx.getStorageSync(CATEGORY_PENDING_NAV_KEY);
    wx.removeStorageSync(CATEGORY_PENDING_NAV_KEY);
    if (!raw || typeof raw !== 'object') return null;
    return raw as CategoryPendingNav;
  } catch {
    return null;
  }
}

function navigateCategoryFilter(params: {
  sceneType?: string;
  slotKey?: string;
}): void {
  const sceneType = (params.sceneType ?? '').trim();
  const slotKey = (params.slotKey ?? '').trim();

  if (!sceneType && !slotKey) {
    wx.showToast({ title: '缺少场景类型', icon: 'none' });
    return;
  }

  if (slotKey && !sceneType) {
    console.warn(
      '[home-scene] RECOMMENDATION_SLOT without sceneType; opening category tab only:',
      slotKey
    );
  }

  setCategoryPendingNav({
    sceneType: sceneType || undefined,
    occasionTag: sceneType || undefined,
    filterMode: !!sceneType,
    slotKey: slotKey || undefined,
  });

  wx.switchTab({
    url: CATEGORY_TAB_PATH,
    fail: (err) => {
      console.error('[home-scene] switchTab category failed', err);
      wx.showToast({ title: '页面跳转失败', icon: 'none' });
    },
  });
}

function navigateCustomUrl(rawPath: string): void {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    wx.showToast({ title: '缺少跳转路径', icon: 'none' });
    return;
  }

  const { path, query } = parseMiniProgramPath(trimmed);

  if (path === CATEGORY_TAB_PATH) {
    const sceneType = (query.sceneType ?? query.occasionTag ?? '').trim();
    setCategoryPendingNav({
      sceneType,
      occasionTag: sceneType,
      filterMode: query.filterMode === '1' || !!sceneType,
      slotKey: query.slotKey,
    });
    wx.switchTab({
      url: CATEGORY_TAB_PATH,
      fail: (err) => {
        console.error('[home-scene] switchTab custom category failed', err);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      },
    });
    return;
  }

  if (isTabBarPage(path)) {
    wx.switchTab({
      url: path,
      fail: (err) => {
        console.error('[home-scene] switchTab failed', path, err);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      },
    });
    return;
  }

  const url = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  wx.navigateTo({
    url,
    fail: (err) => {
      console.error('[home-scene] navigateTo failed', url, err);
      wx.showToast({ title: '页面跳转失败', icon: 'none' });
    },
  });
}

/** 构建场景入口跳转 URL（仅供调试或非 tab 场景；tab 页请用 navigateToSceneEntry） */
export function buildSceneEntryNavigateUrl(entry: HomeSceneEntryNavigateInput): string {
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
    return `${CATEGORY_TAB_PATH}?${params.toString()}`;
  }

  const occasion = (entry.targetValue ?? sceneType).trim();
  if (!occasion) {
    return CATEGORY_TAB_PATH;
  }
  return `${CATEGORY_TAB_PATH}?sceneType=${encodeURIComponent(occasion)}&filterMode=1&occasionTag=${encodeURIComponent(occasion)}`;
}

/** 导航到场景入口目标页 */
export function navigateToSceneEntry(entry: HomeSceneEntryNavigateInput | null | undefined): void {
  console.log('[home-scene] navigate', entry);

  if (!entry) {
    wx.showToast({ title: '场景入口无效', icon: 'none' });
    return;
  }

  const targetType = normalizeTargetType(entry.targetType);
  const sceneType = (entry.sceneType ?? '').trim();

  if (targetType === TARGET_CUSTOM_URL) {
    const path = (entry.targetValue ?? '').trim();
    if (!path) {
      if (sceneType) {
        navigateCategoryFilter({ sceneType });
      } else {
        wx.showToast({ title: '缺少跳转路径', icon: 'none' });
      }
      return;
    }
    navigateCustomUrl(path);
    return;
  }

  if (targetType === TARGET_RECOMMENDATION_SLOT) {
    const slotKey = (entry.linkedRecommendationSlotKey ?? entry.targetValue ?? '').trim();
    if (!sceneType && !slotKey) {
      wx.showToast({ title: '推荐位配置不完整', icon: 'none' });
      return;
    }
    navigateCategoryFilter({
      sceneType: sceneType || undefined,
      slotKey: slotKey || undefined,
    });
    return;
  }

  const occasion = (entry.targetValue ?? sceneType).trim();
  if (!occasion) {
    wx.showToast({ title: '缺少场景类型', icon: 'none' });
    return;
  }

  navigateCategoryFilter({ sceneType: occasion });
}
