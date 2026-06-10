import type { WechatProductTagDisplay } from './product';
import { getSceneIcon } from './icons';

/** 筛选项：内部稳定 key + 中文 label */
export type FilterOption = { key: string; label: string };

export const OCCASION_FILTER_OPTIONS: FilterOption[] = [
  { key: 'BIRTHDAY', label: '生日' },
  { key: 'ANNIVERSARY', label: '纪念日' },
  { key: 'VISIT', label: '探望' },
  { key: 'APOLOGY', label: '道歉' },
  { key: 'BUSINESS', label: '商务' },
  { key: 'OPENING', label: '开业' },
  { key: 'DAILY_SURPRISE', label: '日常惊喜' },
];

export const BUDGET_FILTER_OPTIONS: FilterOption[] = [
  { key: 'BUDGET_UNDER_268', label: '268 以下' },
  { key: 'BUDGET_268_398', label: '268–398' },
  { key: 'BUDGET_398_498', label: '398–498' },
  { key: 'BUDGET_498_698', label: '498–698' },
  { key: 'BUDGET_698_PLUS', label: '698+' },
];

export const COLOR_FILTER_OPTIONS: FilterOption[] = [
  { key: 'PINK', label: '粉色' },
  { key: 'WHITE_GREEN', label: '白绿' },
  { key: 'ORANGE', label: '橙色' },
  { key: 'YELLOW', label: '黄色' },
  { key: 'PURPLE', label: '紫色' },
  { key: 'RED', label: '红色' },
  { key: 'MORANDI', label: '莫兰迪' },
  { key: 'VINTAGE', label: '复古' },
  { key: 'HIGH_CLASS', label: '高级感' },
];

export const STYLE_FILTER_OPTIONS: FilterOption[] = [
  { key: 'KOREAN', label: '韩式' },
  { key: 'FRENCH', label: '法式' },
  { key: 'WILD_NATURAL', label: '自然野趣' },
  { key: 'MODERN', label: '现代感' },
  { key: 'SWEET', label: '甜美' },
  { key: 'COOL', label: '清冷' },
  { key: 'ROMANTIC', label: '浪漫' },
  { key: 'GARDEN', label: '花园感' },
];

export const RELATIONSHIP_FILTER_OPTIONS: FilterOption[] = [
  { key: 'PARTNER', label: '伴侣' },
  { key: 'MOTHER', label: '妈妈' },
  { key: 'FRIEND', label: '朋友' },
  { key: 'CLIENT', label: '客户' },
  { key: 'COLLEAGUE', label: '同事' },
  { key: 'TEACHER', label: '老师' },
];

export type ProductFilters = {
  occasion?: string;
  budget?: string;
  color?: string;
  style?: string;
  relationship?: string;
};

export type FilterGroup = {
  id: keyof ProductFilters;
  title: string;
  options: FilterOption[];
};

export const FILTER_GROUPS: FilterGroup[] = [
  { id: 'occasion', title: '送花场景', options: OCCASION_FILTER_OPTIONS },
  { id: 'budget', title: '预算', options: BUDGET_FILTER_OPTIONS },
  { id: 'color', title: '色系', options: COLOR_FILTER_OPTIONS },
  { id: 'style', title: '风格', options: STYLE_FILTER_OPTIONS },
  { id: 'relationship', title: '适合关系', options: RELATIONSHIP_FILTER_OPTIONS },
];

const ALL_OPTIONS: FilterOption[] = [
  ...OCCASION_FILTER_OPTIONS,
  ...BUDGET_FILTER_OPTIONS,
  ...COLOR_FILTER_OPTIONS,
  ...STYLE_FILTER_OPTIONS,
  ...RELATIONSHIP_FILTER_OPTIONS,
];

export function labelByFilterKey(key: string): string {
  return ALL_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function hasActiveFilters(filters: ProductFilters): boolean {
  return !!(
    filters.occasion ||
    filters.budget ||
    filters.color ||
    filters.style ||
    filters.relationship
  );
}

export function clearFilters(): ProductFilters {
  return {};
}

export function sceneTitleByKey(key: string): string {
  const map: Record<string, string> = {
    BIRTHDAY: '生日送花',
    ANNIVERSARY: '纪念日推荐',
    VISIT: '探望慰问',
    APOLOGY: '道歉表达',
    BUSINESS: '商务礼赠',
    OPENING: '开业花礼',
    DAILY_SURPRISE: '日常惊喜',
  };
  return map[key] ?? '按场景选花';
}

export function sceneDescriptionByKey(key: string): string {
  const map: Record<string, string> = {
    BIRTHDAY: '为重要的人准备一份有记忆点的生日表达。',
    ANNIVERSARY: '把那些说不出口的认真，交给花来表达。',
    VISIT: '温柔、克制、让人安心的花礼。',
    APOLOGY: '一束花不是答案，但可以是一次认真开口。',
    BUSINESS: '体面、克制、有品质感的花礼选择。',
    OPENING: '开业时刻，用花礼传递祝福与体面。',
    DAILY_SURPRISE: '不用等节日，也可以让今天变得特别。',
  };
  return map[key] ?? '按场景选花，找到更适合这次表达的花束。';
}

export function buildFilterChips(filters: ProductFilters) {
  const chips: Array<{ groupId: keyof ProductFilters; key: string; label: string }> = [];
  for (const group of FILTER_GROUPS) {
    const key = filters[group.id];
    if (key) {
      chips.push({ groupId: group.id, key, label: labelByFilterKey(key) });
    }
  }
  return chips;
}

export function buildFilterGroupsUi(filters: ProductFilters) {
  return FILTER_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    options: group.options.map((opt) => ({
      ...opt,
      active: filters[group.id] === opt.key,
    })),
  }));
}

/** @deprecated 请使用服务端 tag 过滤；保留仅供兼容 */
export function filterProductsByTags<T extends {
  occasionTags: WechatProductTagDisplay[];
  budgetTags: WechatProductTagDisplay[];
  colorTags: WechatProductTagDisplay[];
  styleTags: WechatProductTagDisplay[];
  relationshipTags: WechatProductTagDisplay[];
}>(products: T[], filters: ProductFilters): T[] {
  return products.filter((p) => {
    const has = (tags: WechatProductTagDisplay[], key?: string) =>
      !key || tags.some((t) => t.key === key);
    return (
      has(p.occasionTags, filters.occasion) &&
      has(p.budgetTags, filters.budget) &&
      has(p.colorTags, filters.color) &&
      has(p.styleTags, filters.style) &&
      has(p.relationshipTags, filters.relationship)
    );
  });
}

export function sceneIconPath(key: string): string {
  return getSceneIcon(key);
}
