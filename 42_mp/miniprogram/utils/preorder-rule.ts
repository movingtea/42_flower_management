/** 小程序端大批量提前预订规则（与后端 preorder-rule-pure 语义对齐） */

export interface BulkPreorderRule {
  enabled: boolean;
  threshold: number | null;
  minLeadDays: number | null;
  message: string | null;
}

export interface BulkPreorderLineInput {
  skuId: string;
  productName: string;
  skuName: string;
  quantity: number;
  bulkPreorderRule?: BulkPreorderRule | null;
}

export interface BulkPreorderViolation {
  skuId: string;
  earliestDeliveryDate: string;
  message: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiMidnightUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
}

function getShanghaiCalendarParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

function appDateStringFromParts(parts: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addShanghaiCalendarDays(
  parts: { year: number; month: number; day: number },
  days: number
): { year: number; month: number; day: number } {
  const nextMs =
    shanghaiMidnightUtcMs(parts.year, parts.month, parts.day) + days * MS_PER_DAY;
  return getShanghaiCalendarParts(new Date(nextMs));
}

export function getTodayShanghaiDateString(now: Date = new Date()): string {
  return appDateStringFromParts(getShanghaiCalendarParts(now));
}

export function extractDeliveryDatePart(deliveryDate: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(deliveryDate.trim());
  return match ? match[1] : null;
}

export function computeEarliestDeliveryDate(
  minLeadDays: number,
  now: Date = new Date()
): string {
  const today = getTodayShanghaiDateString(now);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return today;
  return appDateStringFromParts(
    addShanghaiCalendarDays(
      {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      },
      minLeadDays
    )
  );
}

export function formatDefaultBulkPreorderHint(
  threshold: number,
  minLeadDays: number
): string {
  return `购买 ${threshold} 件及以上需提前 ${minLeadDays} 天预订。`;
}

export function formatSkuBulkPreorderHint(rule: BulkPreorderRule): string | null {
  if (!rule.enabled || rule.threshold == null || rule.minLeadDays == null) {
    return null;
  }
  if (rule.message?.trim()) {
    return rule.message
      .replace(/\{threshold\}/g, String(rule.threshold))
      .replace(/\{minLeadDays\}/g, String(rule.minLeadDays));
  }
  return formatDefaultBulkPreorderHint(rule.threshold, rule.minLeadDays);
}

export function isBulkQuantityHit(
  rule: BulkPreorderRule | null | undefined,
  quantity: number
): boolean {
  if (!rule?.enabled || rule.threshold == null) return false;
  return quantity >= rule.threshold;
}

export function evaluateCheckoutBulkPreorder(input: {
  items: BulkPreorderLineInput[];
  deliveryDate: string;
  now?: Date;
}): {
  allowed: boolean;
  violations: BulkPreorderViolation[];
  earliestDeliveryDate: string | null;
} {
  const now = input.now ?? new Date();
  const selectedDate = extractDeliveryDatePart(input.deliveryDate);
  if (!selectedDate) {
    return { allowed: false, violations: [], earliestDeliveryDate: null };
  }

  const violations: BulkPreorderViolation[] = [];
  let orderEarliest: string | null = null;

  for (const item of input.items) {
    const rule = item.bulkPreorderRule;
    if (!rule?.enabled || rule.threshold == null || rule.minLeadDays == null) {
      continue;
    }
    if (item.quantity < rule.threshold) continue;

    const earliestDeliveryDate = computeEarliestDeliveryDate(
      rule.minLeadDays,
      now
    );
    if (!orderEarliest || earliestDeliveryDate > orderEarliest) {
      orderEarliest = earliestDeliveryDate;
    }

    if (selectedDate < earliestDeliveryDate) {
      violations.push({
        skuId: item.skuId,
        earliestDeliveryDate,
        message:
          rule.message?.trim() ||
          '这份花礼数量较多，我们需要提前为你备花和制作，暂不支持当天送达。',
      });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    earliestDeliveryDate: orderEarliest,
  };
}

export function computeOrderEarliestDeliveryDate(
  items: BulkPreorderLineInput[],
  now: Date = new Date()
): string | null {
  let orderEarliest: string | null = null;
  for (const item of items) {
    const rule = item.bulkPreorderRule;
    if (!rule?.enabled || rule.threshold == null || rule.minLeadDays == null) {
      continue;
    }
    if (item.quantity < rule.threshold) continue;
    const earliest = computeEarliestDeliveryDate(rule.minLeadDays, now);
    if (!orderEarliest || earliest > orderEarliest) {
      orderEarliest = earliest;
    }
  }
  return orderEarliest;
}
