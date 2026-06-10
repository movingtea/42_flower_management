type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const CUSTOMER_SOURCE_LABELS: Record<string, string> = {
  MINI_PROGRAM: "微信小程序",
  WECHAT: "微信",
  XIAOHONGSHU: "小红书",
  DOUYIN: "抖音",
  FRIEND_REFERRAL: "朋友介绍",
  OFFLINE: "线下",
  MANUAL: "手工录入",
  OTHER: "其他",
};

const RECIPIENT_RELATION_LABELS: Record<string, string> = {
  SELF: "本人",
  PARTNER: "伴侣",
  MOTHER: "母亲",
  FATHER: "父亲",
  FAMILY: "家人",
  FRIEND: "朋友",
  COLLEAGUE: "同事",
  CLIENT: "客户",
  TEACHER: "老师",
  OTHER: "其他",
};

const GIFT_OCCASION_LABELS: Record<string, string> = {
  BIRTHDAY: "生日",
  ANNIVERSARY: "纪念日",
  VALENTINE: "情人节",
  QIXI: "七夕",
  MOTHERS_DAY: "母亲节",
  GRADUATION: "毕业",
  VISIT: "探望",
  APOLOGY: "道歉",
  BUSINESS: "商务",
  OPENING: "开业",
  WEDDING: "婚礼",
  DAILY_SURPRISE: "日常惊喜",
  OTHER: "其他",
};

const REMINDER_TYPE_LABELS: Record<string, string> = {
  BIRTHDAY: "生日",
  ANNIVERSARY: "纪念日",
  FOLLOW_UP: "跟进",
  FESTIVAL: "节日",
  CUSTOM: "自定义",
};

const REMINDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "待跟进",
  DONE: "已完成",
  SNOOZED: "稍后提醒",
  CANCELLED: "已取消",
};

const REMINDER_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  PENDING: "warning",
  DONE: "success",
  SNOOZED: "info",
  CANCELLED: "default",
};

export const GIFT_OCCASION_OPTIONS = Object.entries(GIFT_OCCASION_LABELS).map(
  ([key, label]) => ({ key, label })
);

function lookupLabel(
  map: Record<string, string>,
  key: string | null | undefined,
  fallback = "其他"
): string {
  if (!key) return fallback;
  return map[key] ?? key;
}

export function getCustomerSourceLabel(key: string | null | undefined): string {
  return lookupLabel(CUSTOMER_SOURCE_LABELS, key);
}

export function getRecipientRelationLabel(
  key: string | null | undefined,
  customLabel?: string | null
): string {
  if (customLabel?.trim()) return customLabel.trim();
  return lookupLabel(RECIPIENT_RELATION_LABELS, key);
}

export function getGiftOccasionLabel(
  key: string | null | undefined,
  customLabel?: string | null
): string {
  if (customLabel?.trim()) return customLabel.trim();
  return lookupLabel(GIFT_OCCASION_LABELS, key);
}

export function getReminderTypeLabel(key: string | null | undefined): string {
  return lookupLabel(REMINDER_TYPE_LABELS, key);
}

export function getReminderStatusLabel(key: string | null | undefined): string {
  return lookupLabel(REMINDER_STATUS_LABELS, key, "未知");
}

export function getReminderStatusVariant(
  key: string | null | undefined
): BadgeVariant {
  if (!key) return "default";
  return REMINDER_STATUS_VARIANTS[key] ?? "default";
}

export function parseOccasionTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(Object.keys(GIFT_OCCASION_LABELS));
  return [
    ...new Set(
      raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => valid.has(item))
    ),
  ];
}
