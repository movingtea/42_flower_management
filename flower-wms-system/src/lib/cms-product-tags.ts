export type CmsProductTagType =
  | "occasion"
  | "color"
  | "style"
  | "relationship"
  | "budget"
  | "positioning";

export type CmsProductTagOption = {
  key: string;
  label: string;
};

export const CMS_OCCASION_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "BIRTHDAY", label: "生日" },
  { key: "ANNIVERSARY", label: "纪念日" },
  { key: "VALENTINE", label: "情人节" },
  { key: "QIXI", label: "七夕" },
  { key: "MOTHERS_DAY", label: "母亲节" },
  { key: "GRADUATION", label: "毕业" },
  { key: "VISIT", label: "探望" },
  { key: "APOLOGY", label: "道歉" },
  { key: "BUSINESS", label: "商务" },
  { key: "OPENING", label: "开业" },
  { key: "WEDDING", label: "婚礼" },
  { key: "DAILY_SURPRISE", label: "日常惊喜" },
  { key: "OTHER", label: "其他" },
];

export const CMS_COLOR_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "PINK", label: "粉色" },
  { key: "WHITE_GREEN", label: "白绿" },
  { key: "ORANGE", label: "橙色" },
  { key: "YELLOW", label: "黄色" },
  { key: "PURPLE", label: "紫色" },
  { key: "RED", label: "红色" },
  { key: "BLUE", label: "蓝色" },
  { key: "MORANDI", label: "莫兰迪" },
  { key: "VINTAGE", label: "复古" },
  { key: "HIGH_CLASS", label: "高级感" },
  { key: "MIXED", label: "混合色" },
];

export const CMS_STYLE_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "KOREAN", label: "韩式" },
  { key: "FRENCH", label: "法式" },
  { key: "WILD_NATURAL", label: "自然野趣" },
  { key: "MODERN", label: "现代感" },
  { key: "SWEET", label: "甜美" },
  { key: "COOL", label: "清冷" },
  { key: "ROMANTIC", label: "浪漫" },
  { key: "GARDEN", label: "花园感" },
  { key: "MINIMAL", label: "极简" },
  { key: "LUXURY", label: "高级奢华" },
];

export const CMS_RELATIONSHIP_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "PARTNER", label: "伴侣" },
  { key: "MOTHER", label: "妈妈" },
  { key: "FATHER", label: "爸爸" },
  { key: "FAMILY", label: "家人" },
  { key: "FRIEND", label: "朋友" },
  { key: "CLIENT", label: "客户" },
  { key: "COLLEAGUE", label: "同事" },
  { key: "TEACHER", label: "老师" },
  { key: "SELF", label: "自己" },
  { key: "OTHER", label: "其他" },
];

export const CMS_BUDGET_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "BUDGET_UNDER_268", label: "268 以下" },
  { key: "BUDGET_268_398", label: "268–398" },
  { key: "BUDGET_398_498", label: "398–498" },
  { key: "BUDGET_498_698", label: "498–698" },
  { key: "BUDGET_698_PLUS", label: "698+" },
];

export const CMS_POSITIONING_TAG_OPTIONS: CmsProductTagOption[] = [
  { key: "DAILY_PROMOTE", label: "日常主推" },
  { key: "FESTIVAL_LIMITED", label: "节日限定" },
  { key: "IMAGE_PRODUCT", label: "形象款" },
  { key: "HIGH_TICKET", label: "高客单" },
  { key: "ENTRY_PRODUCT", label: "入门款" },
  { key: "NEW_PRODUCT", label: "新品" },
  { key: "STABLE_MARGIN", label: "稳定毛利" },
  { key: "TEST_PRODUCT", label: "测试款" },
  { key: "CLEARANCE", label: "清库存" },
];

const TAG_LABEL_MAP: Record<CmsProductTagType, Record<string, string>> = {
  occasion: Object.fromEntries(
    CMS_OCCASION_TAG_OPTIONS.map((o) => [o.key, o.label])
  ),
  color: Object.fromEntries(CMS_COLOR_TAG_OPTIONS.map((o) => [o.key, o.label])),
  style: Object.fromEntries(CMS_STYLE_TAG_OPTIONS.map((o) => [o.key, o.label])),
  relationship: Object.fromEntries(
    CMS_RELATIONSHIP_TAG_OPTIONS.map((o) => [o.key, o.label])
  ),
  budget: Object.fromEntries(
    CMS_BUDGET_TAG_OPTIONS.map((o) => [o.key, o.label])
  ),
  positioning: Object.fromEntries(
    CMS_POSITIONING_TAG_OPTIONS.map((o) => [o.key, o.label])
  ),
};

const TAG_OPTIONS_BY_TYPE: Record<CmsProductTagType, CmsProductTagOption[]> = {
  occasion: CMS_OCCASION_TAG_OPTIONS,
  color: CMS_COLOR_TAG_OPTIONS,
  style: CMS_STYLE_TAG_OPTIONS,
  relationship: CMS_RELATIONSHIP_TAG_OPTIONS,
  budget: CMS_BUDGET_TAG_OPTIONS,
  positioning: CMS_POSITIONING_TAG_OPTIONS,
};

export function getCmsProductTagLabel(
  type: CmsProductTagType,
  key: string
): string {
  return TAG_LABEL_MAP[type][key] ?? key;
}

export function parseCmsProductTagKeys(
  type: CmsProductTagType,
  raw: unknown
): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(TAG_OPTIONS_BY_TYPE[type].map((o) => o.key));
  return [
    ...new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => valid.has(item))
    ),
  ];
}

export function parseSellingPoints(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    ),
  ];
}

/** 从 Prisma Json 字段解析标签 key 数组 */
export function jsonToTagKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

export type CmsProductTagDisplay = {
  key: string;
  label: string;
};

export function toTagDisplayList(
  type: CmsProductTagType,
  keys: string[] | null | undefined
): CmsProductTagDisplay[] {
  if (!keys?.length) return [];
  return keys.map((key) => ({
    key,
    label: getCmsProductTagLabel(type, key),
  }));
}

export type WechatProductOperationTags = {
  occasionTags: CmsProductTagDisplay[];
  colorTags: CmsProductTagDisplay[];
  styleTags: CmsProductTagDisplay[];
  relationshipTags: CmsProductTagDisplay[];
  budgetTags: CmsProductTagDisplay[];
  positioningTags: CmsProductTagDisplay[];
  sellingPoints: string[];
};

export function buildWechatOperationTags(spu: {
  occasionTags?: string[];
  colorTags?: unknown;
  styleTags?: unknown;
  relationshipTags?: unknown;
  budgetTags?: unknown;
  positioningTags?: unknown;
  sellingPoints?: unknown;
}): WechatProductOperationTags {
  return {
    occasionTags: toTagDisplayList("occasion", spu.occasionTags),
    colorTags: toTagDisplayList("color", jsonToTagKeys(spu.colorTags)),
    styleTags: toTagDisplayList("style", jsonToTagKeys(spu.styleTags)),
    relationshipTags: toTagDisplayList(
      "relationship",
      jsonToTagKeys(spu.relationshipTags)
    ),
    budgetTags: toTagDisplayList("budget", jsonToTagKeys(spu.budgetTags)),
    positioningTags: toTagDisplayList(
      "positioning",
      jsonToTagKeys(spu.positioningTags)
    ),
    sellingPoints: jsonToTagKeys(spu.sellingPoints),
  };
}
