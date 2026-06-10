/**
 * 小程序统一图标映射（Lucide Icons 风格 PNG）
 *
 * - 本项目 UI 图标统一使用 Lucide Icons，由 scripts/export-lucide-icons.mjs 导出。
 * - 页面必须通过本 mapping / getIconPath / mp-icon 引用，勿硬编码路径。
 * - 不要使用 Python 自绘图标作为正式资源；新增图标请运行 npm run icons:export。
 * - CMS 返回 iconKey 时通过 getIconByKey 解析，不直接信任任意 URL/路径。
 * - iconKey / sceneType 未知时使用 fallback。
 *
 * 资源目录：miniprogram/assets/icons/
 */

const ICON_BASE = '/assets/icons';

const FALLBACK = `${ICON_BASE}/common/fallback.png`;

/** CMS iconKey → 场景图标（kebab-case 文件名） */
export const ICON_KEY_MAP: Record<string, string> = {
  birthday: `${ICON_BASE}/scenes/birthday.png`,
  anniversary: `${ICON_BASE}/scenes/anniversary.png`,
  visit: `${ICON_BASE}/scenes/visit.png`,
  apology: `${ICON_BASE}/scenes/apology.png`,
  business: `${ICON_BASE}/scenes/business.png`,
  'daily-surprise': `${ICON_BASE}/scenes/daily-surprise.png`,
  valentine: `${ICON_BASE}/scenes/valentine.png`,
  qixi: `${ICON_BASE}/scenes/qixi.png`,
  'mothers-day': `${ICON_BASE}/scenes/mothers-day.png`,
  graduation: `${ICON_BASE}/scenes/graduation.png`,
  opening: `${ICON_BASE}/scenes/opening.png`,
  wedding: `${ICON_BASE}/scenes/wedding.png`,
  gift: `${ICON_BASE}/scenes/gift.png`,
  heart: `${ICON_BASE}/scenes/heart.png`,
  calendar: `${ICON_BASE}/scenes/calendar.png`,
  sparkle: `${ICON_BASE}/scenes/sparkle.png`,
  custom: `${ICON_BASE}/common/fallback.png`,
  fallback: FALLBACK,
};

/** 场景 occasionTag / sceneType */
export const SCENE_ICONS: Record<string, string> = {
  BIRTHDAY: ICON_KEY_MAP.birthday,
  ANNIVERSARY: ICON_KEY_MAP.anniversary,
  VISIT: ICON_KEY_MAP.visit,
  APOLOGY: ICON_KEY_MAP.apology,
  BUSINESS: ICON_KEY_MAP.business,
  DAILY_SURPRISE: ICON_KEY_MAP['daily-surprise'],
  VALENTINE: ICON_KEY_MAP.valentine,
  QIXI: ICON_KEY_MAP.qixi,
  MOTHERS_DAY: ICON_KEY_MAP['mothers-day'],
  GRADUATION: ICON_KEY_MAP.graduation,
  OPENING: ICON_KEY_MAP.opening,
  WEDDING: ICON_KEY_MAP.wedding,
  OTHER: ICON_KEY_MAP.custom,
};

/** 商品标签 / 筛选维度（Lucide: sparkles, palette, brush, wallet, users） */
export const TAG_ICONS: Record<string, string> = {
  occasion: `${ICON_BASE}/product/sparkles.png`,
  color: `${ICON_BASE}/product/palette.png`,
  style: `${ICON_BASE}/product/brush.png`,
  budget: `${ICON_BASE}/product/wallet.png`,
  relationship: `${ICON_BASE}/product/users.png`,
};

/** 商品详情说明区块 */
export const PRODUCT_ICONS = {
  suitableScene: TAG_ICONS.occasion,
  suitablePerson: `${ICON_BASE}/product/user-round-heart.png`,
  flowerMaterial: `${ICON_BASE}/product/flower-2.png`,
  delivery: `${ICON_BASE}/product/truck.png`,
  care: `${ICON_BASE}/product/leaf.png`,
  note: `${ICON_BASE}/product/mail.png`,
} as const;

/** 下单 / 礼赠表单 */
export const ORDER_ICONS = {
  recipient: `${ICON_BASE}/order/recipient.png`,
  phone: `${ICON_BASE}/order/phone.png`,
  address: `${ICON_BASE}/order/address.png`,
  delivery: `${ICON_BASE}/order/delivery.png`,
  deliveryTime: `${ICON_BASE}/order/delivery-time.png`,
  cardMessage: `${ICON_BASE}/order/card-message.png`,
  importantDate: `${ICON_BASE}/order/important-date.png`,
  preference: `${ICON_BASE}/order/preference.png`,
  dislikedFlowers: `${ICON_BASE}/order/disliked-flowers.png`,
  occasion: `${ICON_BASE}/order/occasion.png`,
  relation: `${ICON_BASE}/order/relation.png`,
} as const;

/** 个人中心 */
export const PROFILE_ICONS = {
  profile: `${ICON_BASE}/profile/profile.png`,
  orders: `${ICON_BASE}/profile/orders.png`,
  recipients: `${ICON_BASE}/profile/recipients.png`,
  dates: `${ICON_BASE}/profile/dates.png`,
  importantDates: `${ICON_BASE}/profile/dates.png`,
  contact: `${ICON_BASE}/profile/contact.png`,
  about: `${ICON_BASE}/profile/about.png`,
} as const;

/** 通用 / 空状态 */
export const COMMON_ICONS = {
  fallback: FALLBACK,
  empty: `${ICON_BASE}/common/empty.png`,
  scene: `${ICON_BASE}/common/scene.png`,
  relationship: `${ICON_BASE}/common/relationship.png`,
  flower: `${ICON_BASE}/common/flower.png`,
  deliveryInfo: `${ICON_BASE}/common/delivery-info.png`,
  care: `${ICON_BASE}/common/care.png`,
  emptyOrder: `${ICON_BASE}/common/empty-order.png`,
  emptyRecipient: `${ICON_BASE}/common/empty-recipient.png`,
  emptyProduct: `${ICON_BASE}/common/empty-product.png`,
  cart: `${ICON_BASE}/common/cart.png`,
  filter: `${ICON_BASE}/common/filter.png`,
} as const;

/** 底部 TabBar（与 app.json images/tabbar 同步，Lucide 导出） */
export const TAB_ICONS = {
  home: `${ICON_BASE}/tabs/home.png`,
  homeActive: `${ICON_BASE}/tabs/home-active.png`,
  category: `${ICON_BASE}/tabs/category.png`,
  categoryActive: `${ICON_BASE}/tabs/category-active.png`,
  cart: `${ICON_BASE}/tabs/cart.png`,
  cartActive: `${ICON_BASE}/tabs/cart-active.png`,
  mine: `${ICON_BASE}/tabs/mine.png`,
  mineActive: `${ICON_BASE}/tabs/mine-active.png`,
} as const;

/** mp-icon name 别名 → 实际 mapping key */
const ICON_NAME_ALIASES: Record<string, string> = {
  dates: 'dates',
  importantDates: 'importantDates',
  empty: 'empty',
  suitableScene: 'suitableScene',
  suitablePerson: 'suitablePerson',
  flowerMaterial: 'flowerMaterial',
  deliveryTime: 'deliveryTime',
};

export type IconName =
  | keyof typeof SCENE_ICONS
  | keyof typeof ORDER_ICONS
  | keyof typeof PROFILE_ICONS
  | keyof typeof COMMON_ICONS
  | keyof typeof PRODUCT_ICONS
  | keyof typeof TAG_ICONS
  | keyof typeof ICON_NAME_ALIASES;

/** 根据 CMS iconKey 获取图标路径 */
export function getIconByKey(
  iconKey?: string | null,
  sceneType?: string | null
): string {
  const key = iconKey?.trim().toLowerCase();
  if (key && ICON_KEY_MAP[key]) return ICON_KEY_MAP[key];
  if (key) return FALLBACK;
  return getSceneIcon(sceneType);
}

/** 根据 sceneType / occasionTag 获取场景图标 */
export function getSceneIcon(key?: string | null): string {
  if (!key) return FALLBACK;
  return SCENE_ICONS[key.toUpperCase()] ?? FALLBACK;
}

function resolveNamedIcon(name: string): string | null {
  const alias = ICON_NAME_ALIASES[name] ?? name;

  if (PRODUCT_ICONS[alias as keyof typeof PRODUCT_ICONS]) {
    return PRODUCT_ICONS[alias as keyof typeof PRODUCT_ICONS];
  }
  if (ORDER_ICONS[alias as keyof typeof ORDER_ICONS]) {
    return ORDER_ICONS[alias as keyof typeof ORDER_ICONS];
  }
  if (PROFILE_ICONS[alias as keyof typeof PROFILE_ICONS]) {
    return PROFILE_ICONS[alias as keyof typeof PROFILE_ICONS];
  }
  if (COMMON_ICONS[alias as keyof typeof COMMON_ICONS]) {
    return COMMON_ICONS[alias as keyof typeof COMMON_ICONS];
  }
  if (TAG_ICONS[alias]) return TAG_ICONS[alias];

  const upper = alias.toUpperCase();
  if (SCENE_ICONS[upper]) return SCENE_ICONS[upper];

  const kebab = alias.trim().toLowerCase();
  if (ICON_KEY_MAP[kebab]) return ICON_KEY_MAP[kebab];

  return null;
}

/** 统一入口：按 mp-icon name 获取图标路径，缺失时 fallback */
export function getIconPath(name?: string | null): string {
  if (!name) return FALLBACK;
  return resolveNamedIcon(name) ?? FALLBACK;
}

/** 首页场景入口本地 fallback（CMS 未配置或 API 失败时使用） */
export const HOME_SCENE_ENTRIES_FALLBACK = [
  {
    id: 'fallback-birthday',
    title: '生日',
    subtitle: '把祝福做成花',
    sceneType: 'BIRTHDAY',
    iconKey: 'birthday',
    sortOrder: 10,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
  {
    id: 'fallback-anniversary',
    title: '纪念日',
    subtitle: '记住重要的一天',
    sceneType: 'ANNIVERSARY',
    iconKey: 'anniversary',
    sortOrder: 20,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
  {
    id: 'fallback-visit',
    title: '探望',
    subtitle: '带去一份关怀',
    sceneType: 'VISIT',
    iconKey: 'visit',
    sortOrder: 30,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
  {
    id: 'fallback-apology',
    title: '道歉',
    subtitle: '用花说对不起',
    sceneType: 'APOLOGY',
    iconKey: 'apology',
    sortOrder: 40,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
  {
    id: 'fallback-business',
    title: '商务',
    subtitle: '体面又有温度',
    sceneType: 'BUSINESS',
    iconKey: 'business',
    sortOrder: 50,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
  {
    id: 'fallback-daily_surprise',
    title: '日常惊喜',
    subtitle: '不需要理由',
    sceneType: 'DAILY_SURPRISE',
    iconKey: 'daily-surprise',
    sortOrder: 60,
    targetType: 'PRODUCT_FILTER',
    targetValue: '',
    linkedRecommendationSlotKey: '',
    source: 'FALLBACK',
  },
] as const;

export type HomeSceneEntryDisplay = {
  id: string;
  title: string;
  subtitle: string;
  sceneType: string;
  iconKey: string;
  icon: string;
  sortOrder: number;
  targetType: string;
  targetValue: string;
  linkedRecommendationSlotKey: string;
  source: string;
};

/** @deprecated 使用 API + HOME_SCENE_ENTRIES_FALLBACK */
export const HOME_SCENE_ENTRIES = HOME_SCENE_ENTRIES_FALLBACK.map((e) => ({
  key: e.sceneType,
  label: e.title,
  subtitle: e.subtitle,
}));
