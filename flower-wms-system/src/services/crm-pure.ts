import {
  GiftOccasionType,
  OrderCancelSource,
  OrderStatus,
  ReminderType,
} from "@/generated/prisma/enums";
import {
  addAppCalendarDays,
  coerceDate,
  formatDateInAppTimezoneIso,
  getAppCalendarParts,
  getTodayAppDateString,
  parseAppDateString,
} from "@/lib/datetime";

export type CustomerSourceInput = {
  fromMiniProgram?: boolean;
  source?: string;
};

export type OrderStatsInput = {
  status: OrderStatus | string;
  payAmount: number;
  createdAt: Date;
  paidAt?: Date | null;
  refundAmount?: number | null;
  refundTime?: Date | null;
  cancelSource?: OrderCancelSource | null;
};

export type CustomerStatsResult = {
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
};

const EFFECTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PRODUCTION,
  OrderStatus.DELIVERING,
  OrderStatus.COMPLETED,
];

const REMINDABLE_OCCASION_TYPES: GiftOccasionType[] = [
  GiftOccasionType.BIRTHDAY,
  GiftOccasionType.ANNIVERSARY,
  GiftOccasionType.VALENTINE,
  GiftOccasionType.QIXI,
  GiftOccasionType.MOTHERS_DAY,
  GiftOccasionType.BUSINESS,
  GiftOccasionType.WEDDING,
  GiftOccasionType.OTHER,
];

export function normalizePhone(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[\s-]/g, "");
  if (normalized.startsWith("+86")) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith("86") && normalized.length === 13) {
    normalized = normalized.slice(2);
  }

  if (!normalized) return null;

  if (/^1\d{10}$/.test(normalized)) {
    return normalized;
  }

  return normalized;
}

export function normalizeName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  return trimmed || null;
}

export function maskPhone(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  if (normalized.length < 7) return normalized;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

export function buildCustomerDisplayName(input: {
  buyerName?: string | null;
  wechatNickname?: string | null;
  phone?: string | null;
}): string {
  const name = normalizeName(input.buyerName);
  if (name) return name;

  const nickname = normalizeName(input.wechatNickname);
  if (nickname) return nickname;

  const masked = maskPhone(input.phone);
  if (masked) return masked;

  return "小程序客户";
}

export function inferCustomerSource(input: CustomerSourceInput): "MINI_PROGRAM" {
  if (input.fromMiniProgram || input.source === "MINI_PROGRAM") {
    return "MINI_PROGRAM";
  }
  return "MINI_PROGRAM";
}

function isRefundedOrder(order: OrderStatsInput): boolean {
  return (
    Boolean(order.refundTime) ||
    Number(order.refundAmount ?? 0) > 0 ||
    order.cancelSource === OrderCancelSource.REFUND
  );
}

export function isEffectiveOrderForStats(order: OrderStatsInput): boolean {
  return (
    EFFECTIVE_ORDER_STATUSES.includes(order.status as OrderStatus) &&
    !isRefundedOrder(order)
  );
}

export function calculateCustomerStats(
  orders: OrderStatsInput[]
): CustomerStatsResult {
  const effective = orders
    .filter(isEffectiveOrderForStats)
    .map((order) => ({
      payAmount: Number(order.payAmount) || 0,
      orderAt: order.paidAt ?? order.createdAt,
    }))
    .sort((a, b) => a.orderAt.getTime() - b.orderAt.getTime());

  if (effective.length === 0) {
    return {
      totalOrders: 0,
      totalSpent: 0,
      averageOrderValue: 0,
      firstOrderAt: null,
      lastOrderAt: null,
    };
  }

  const totalSpent = effective.reduce((sum, row) => sum + row.payAmount, 0);
  const totalOrders = effective.length;

  return {
    totalOrders,
    totalSpent: Number(totalSpent.toFixed(2)),
    averageOrderValue: Number((totalSpent / totalOrders).toFixed(2)),
    firstOrderAt: effective[0].orderAt,
    lastOrderAt: effective[effective.length - 1].orderAt,
  };
}

function shanghaiDateToUtcDate(dateString: string): Date {
  const parsed = parseAppDateString(dateString);
  if (!parsed) {
    throw new Error(`日期格式应为 YYYY-MM-DD：${dateString}`);
  }
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) - offsetMs);
}

export function buildReminderDate(
  importantDate: Date,
  reminderType: ReminderType | GiftOccasionType,
  daysBefore = 7,
  now: Date = new Date()
): { remindAt: Date; dueDate: Date } {
  const importantParts = getAppCalendarParts(importantDate);
  const todayKey = getTodayAppDateString(now);
  const todayParts = parseAppDateString(todayKey)!;

  let candidateParts = {
    year: todayParts.year,
    month: importantParts.month,
    day: importantParts.day,
  };

  const candidateKey = `${candidateParts.year}-${String(candidateParts.month).padStart(2, "0")}-${String(candidateParts.day).padStart(2, "0")}`;
  const todayComparable = todayKey;

  if (candidateKey <= todayComparable) {
    candidateParts = {
      year: todayParts.year + 1,
      month: importantParts.month,
      day: importantParts.day,
    };
  }

  const dueDateKey = `${candidateParts.year}-${String(candidateParts.month).padStart(2, "0")}-${String(candidateParts.day).padStart(2, "0")}`;
  const dueDate = shanghaiDateToUtcDate(dueDateKey);

  const remindParts = addAppCalendarDays(
    {
      year: candidateParts.year,
      month: candidateParts.month,
      day: candidateParts.day,
    },
    -daysBefore
  );
  const remindKey = `${remindParts.year}-${String(remindParts.month).padStart(2, "0")}-${String(remindParts.day).padStart(2, "0")}`;
  const remindAt = shanghaiDateToUtcDate(remindKey);

  void reminderType;
  return { remindAt, dueDate };
}

export function mapOccasionTypeToReminderType(
  occasionType: GiftOccasionType
): ReminderType {
  switch (occasionType) {
    case GiftOccasionType.BIRTHDAY:
      return ReminderType.BIRTHDAY;
    case GiftOccasionType.ANNIVERSARY:
    case GiftOccasionType.VALENTINE:
    case GiftOccasionType.QIXI:
    case GiftOccasionType.MOTHERS_DAY:
    case GiftOccasionType.WEDDING:
      return ReminderType.ANNIVERSARY;
    case GiftOccasionType.BUSINESS:
      return ReminderType.FOLLOW_UP;
    default:
      return ReminderType.CUSTOM;
  }
}

export function buildReminderContent(input: {
  customerName?: string | null;
  recipientName?: string | null;
  relationLabel?: string | null;
  occasionType: GiftOccasionType;
  occasionLabel?: string | null;
  daysBefore?: number;
  lastProductName?: string | null;
  lastOrderAmount?: number | null;
}): { title: string; content: string } {
  const customer = normalizeName(input.customerName) ?? "客户";
  const recipient = normalizeName(input.recipientName) ?? "收花人";
  const relation = normalizeName(input.relationLabel);
  const days = input.daysBefore ?? 7;

  const occasionLabel =
    normalizeName(input.occasionLabel) ??
    (input.occasionType === GiftOccasionType.BIRTHDAY
      ? "生日"
      : input.occasionType === GiftOccasionType.ANNIVERSARY
        ? "纪念日"
        : "重要日期");

  const title =
    input.occasionType === GiftOccasionType.BIRTHDAY
      ? "生日复购提醒"
      : input.occasionType === GiftOccasionType.ANNIVERSARY
        ? "纪念日复购提醒"
        : "礼赠复购提醒";

  const relationPart = relation ? `的${relation}` : "";
  let content = `客户 ${customer} 的收花人 ${recipient}${relationPart}${occasionLabel}即将到来（提前 ${days} 天），建议提前联系。`;

  if (input.lastProductName && input.lastOrderAmount != null) {
    content = `客户 ${customer} 的收花人 ${recipient}${relationPart}${occasionLabel}还有 ${days} 天，去年购买了「${input.lastProductName}」¥${Number(input.lastOrderAmount).toFixed(0)}，可提前联系推荐升级款。`;
  }

  return { title, content };
}

export function shouldCreateReminder(input: {
  importantDate?: Date | string | null;
  reminderEnabled?: boolean;
  occasionType?: GiftOccasionType | null;
  now?: Date;
}): boolean {
  if (!input.reminderEnabled) return false;

  const importantDate = coerceDate(input.importantDate);
  if (!importantDate) return false;

  const occasionType = input.occasionType ?? GiftOccasionType.OTHER;
  if (!REMINDABLE_OCCASION_TYPES.includes(occasionType)) {
    return false;
  }

  const now = input.now ?? new Date();
  const { dueDate } = buildReminderDate(
    importantDate,
    mapOccasionTypeToReminderType(occasionType),
    7,
    now
  );

  return dueDate.getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
}

export function getDueDateMonthDay(dueDate: Date): string {
  return formatDateInAppTimezoneIso(dueDate).slice(5);
}

/** 系统内提醒超过 1 天未处理视为过期 */
export const SYSTEM_REMINDER_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function isSystemReminderExpired(
  reminder: { createdAt: Date; status?: string },
  now: Date = new Date()
): boolean {
  if (reminder.status === "COMPLETED" || reminder.status === "DISMISSED") {
    return false;
  }
  return now.getTime() - reminder.createdAt.getTime() > SYSTEM_REMINDER_EXPIRY_MS;
}
