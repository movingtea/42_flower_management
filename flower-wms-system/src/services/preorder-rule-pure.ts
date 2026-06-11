import {
  addAppCalendarDays,
  appDateStringFromParts,
  getTodayAppDateString,
  parseAppDateString,
} from "@/lib/datetime";

export const DEFAULT_BULK_ORDER_THRESHOLD = 5;
export const DEFAULT_BULK_MIN_LEAD_DAYS = 1;

export type PreorderRuleFields = {
  bulkPreorderEnabled?: boolean;
  bulkOrderThreshold?: number | null;
  bulkMinLeadDays?: number | null;
  bulkPreorderMessage?: string | null;
};

export type ResolvedPreorderRule = {
  enabled: boolean;
  threshold: number | null;
  minLeadDays: number | null;
  message: string | null;
  source: "SKU" | "SPU" | "GLOBAL" | "NONE";
};

export type BulkPreorderViolation = {
  skuId: string;
  productName: string;
  skuName: string;
  quantity: number;
  threshold: number;
  minLeadDays: number;
  earliestDeliveryDate: string;
  message: string;
};

export type EvaluateBulkPreorderResult = {
  allowed: boolean;
  violations: BulkPreorderViolation[];
  earliestDeliveryDate: string | null;
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function trimMessage(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 判断规则字段是否配置完整且可生效 */
export function isPreorderRuleConfigValid(
  rule: PreorderRuleFields | null | undefined
): boolean {
  if (!rule?.bulkPreorderEnabled) return false;
  return (
    isPositiveInt(rule.bulkOrderThreshold) && isPositiveInt(rule.bulkMinLeadDays)
  );
}

function resolveFromFields(
  rule: PreorderRuleFields | null | undefined,
  source: ResolvedPreorderRule["source"]
): ResolvedPreorderRule | null {
  if (!isPreorderRuleConfigValid(rule)) {
    return null;
  }
  return {
    enabled: true,
    threshold: rule!.bulkOrderThreshold!,
    minLeadDays: rule!.bulkMinLeadDays!,
    message: trimMessage(rule!.bulkPreorderMessage),
    source,
  };
}

/**
 * 解析 SKU 大批量提前预订规则。
 * 优先级：SKU > SPU > 全局默认（仅当显式传入 globalRule 且有效时）。
 */
export function resolveSkuPreorderRule(input: {
  skuRule?: PreorderRuleFields | null;
  spuRule?: PreorderRuleFields | null;
  globalRule?: PreorderRuleFields | null;
}): ResolvedPreorderRule {
  const skuResolved = resolveFromFields(input.skuRule, "SKU");
  if (skuResolved) return skuResolved;

  const spuResolved = resolveFromFields(input.spuRule, "SPU");
  if (spuResolved) return spuResolved;

  const globalResolved = resolveFromFields(input.globalRule, "GLOBAL");
  if (globalResolved) return globalResolved;

  return {
    enabled: false,
    threshold: null,
    minLeadDays: null,
    message: null,
    source: "NONE",
  };
}

export function extractDeliveryDatePart(deliveryDate: string): string | null {
  const trimmed = deliveryDate.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (!match) return null;
  return parseAppDateString(match[1]) ? match[1] : null;
}

export function computeEarliestDeliveryDate(
  minLeadDays: number,
  now: Date = new Date()
): string {
  const today = getTodayAppDateString(now);
  const todayParts = parseAppDateString(today);
  if (!todayParts) {
    throw new Error(`无法解析业务日期：${today}`);
  }
  return appDateStringFromParts(addAppCalendarDays(todayParts, minLeadDays));
}

export function formatDefaultBulkPreorderHint(
  threshold: number,
  minLeadDays: number
): string {
  return `购买 ${threshold} 件及以上需提前 ${minLeadDays} 天预订。`;
}

export function formatBulkPreorderViolationMessage(
  rule: Pick<ResolvedPreorderRule, "message" | "threshold" | "minLeadDays">,
  quantity: number
): string {
  if (rule.message) {
    return rule.message
      .replace(/\{threshold\}/g, String(rule.threshold ?? ""))
      .replace(/\{minLeadDays\}/g, String(rule.minLeadDays ?? ""))
      .replace(/\{quantity\}/g, String(quantity));
  }
  return "这份花礼数量较多，我们需要提前为你备花和制作，暂不支持当天送达。";
}

export function formatBulkPreorderServerMessage(
  earliestDeliveryDate: string
): string {
  return `当前订单数量较多，需要提前预订，最早可选择 ${earliestDeliveryDate} 配送。`;
}

function compareAppDateStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 评估订单是否满足大批量提前预订配送日期要求。
 * deliveryDate 支持 "YYYY-MM-DD" 或 "YYYY-MM-DD 上午" 等格式。
 */
export function evaluateBulkPreorderRequirement(input: {
  items: Array<{
    skuId: string;
    productName: string;
    skuName: string;
    quantity: number;
    preorderRule: ResolvedPreorderRule;
  }>;
  deliveryDate: string;
  now?: Date;
}): EvaluateBulkPreorderResult {
  const now = input.now ?? new Date();
  const selectedDate = extractDeliveryDatePart(input.deliveryDate);

  if (!selectedDate) {
    return {
      allowed: false,
      violations: [],
      earliestDeliveryDate: null,
    };
  }

  const violations: BulkPreorderViolation[] = [];
  let orderEarliest: string | null = null;

  for (const item of input.items) {
    const rule = item.preorderRule;
    if (!rule.enabled || rule.threshold == null || rule.minLeadDays == null) {
      continue;
    }
    if (item.quantity < rule.threshold) {
      continue;
    }

    const earliestDeliveryDate = computeEarliestDeliveryDate(
      rule.minLeadDays,
      now
    );

    if (
      !orderEarliest ||
      compareAppDateStrings(earliestDeliveryDate, orderEarliest) > 0
    ) {
      orderEarliest = earliestDeliveryDate;
    }

    if (compareAppDateStrings(selectedDate, earliestDeliveryDate) < 0) {
      violations.push({
        skuId: item.skuId,
        productName: item.productName,
        skuName: item.skuName,
        quantity: item.quantity,
        threshold: rule.threshold,
        minLeadDays: rule.minLeadDays,
        earliestDeliveryDate,
        message: formatBulkPreorderViolationMessage(rule, item.quantity),
      });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    earliestDeliveryDate: orderEarliest,
  };
}
