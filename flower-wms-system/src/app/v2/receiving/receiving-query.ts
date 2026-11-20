/**
 * Pure query/presentation helpers for the dedicated purchase receiving page.
 *
 * Prisma filtering stays in the page; these helpers only normalize the URL
 * state and derive the counts/overdue flags shown to the operator so they can
 * be tested without a database.
 */

export const RECEIVING_EPSILON = 1e-8;

export const RECEIVING_STATE_OPTIONS = [
  { value: "open", label: "进行中（已下单 / 部分验收）" },
  { value: "ORDERED", label: "已下单" },
  { value: "PARTIALLY_RECEIVED", label: "部分验收" },
  { value: "RECEIVED", label: "已收货" },
  { value: "DRAFT", label: "草稿" },
  { value: "CANCELLED", label: "已取消" },
  { value: "all", label: "全部状态" },
] as const;

export type ReceivingStateFilter = (typeof RECEIVING_STATE_OPTIONS)[number]["value"];

const RECEIVING_STATES = new Set<string>(RECEIVING_STATE_OPTIONS.map((option) => option.value));

export function normalizeReceivingState(value: unknown): ReceivingStateFilter {
  return typeof value === "string" && RECEIVING_STATES.has(value)
    ? value as ReceivingStateFilter
    : "open";
}

/** Only an open order line with unprocessed quantity can be received or rejected. */
export function isReceivingLineActionable(remainingQty: unknown): boolean {
  const remaining = Number(remainingQty);
  return Number.isFinite(remaining) && remaining > RECEIVING_EPSILON;
}

export function isReceivingLineOverdue(
  expectedAt: Date | null | undefined,
  remainingQty: unknown,
  now: Date,
): boolean {
  if (!expectedAt || !isReceivingLineActionable(remainingQty)) return false;
  const time = expectedAt instanceof Date ? expectedAt.getTime() : Number.NaN;
  return Number.isFinite(time) && time < now.getTime();
}

export type ReceivingLineSummaryInput = {
  purchaseOrderNumber: string;
  expectedAt: Date | null;
  expectedBaseQty: number | null;
  processedQty: number;
  remainingQty: number;
};

export type ReceivingSummary = {
  orderCount: number;
  lineCount: number;
  actionableLineCount: number;
  pendingQty: number;
  overdueLineCount: number;
};

function roundQuantity(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

/**
 * Aggregates receiving KPIs across the current filter. Order count is unique by
 * purchase-order number so partially received orders are not double counted.
 */
export function summarizeReceivingLines(
  lines: readonly ReceivingLineSummaryInput[],
  now: Date,
): ReceivingSummary {
  const orders = new Set<string>();
  let actionableLineCount = 0;
  let pendingQty = 0;
  let overdueLineCount = 0;
  for (const line of lines) {
    orders.add(line.purchaseOrderNumber);
    const remaining = Number(line.remainingQty);
    if (!isReceivingLineActionable(remaining)) continue;
    actionableLineCount += 1;
    pendingQty += Number.isFinite(remaining) ? remaining : 0;
    if (isReceivingLineOverdue(line.expectedAt, remaining, now)) overdueLineCount += 1;
  }
  return {
    orderCount: orders.size,
    lineCount: lines.length,
    actionableLineCount,
    pendingQty: roundQuantity(pendingQty),
    overdueLineCount,
  };
}

export function receivingLineStatus(progress: {
  processedQty: number;
  remainingQty: number;
}): { label: string; tone: "success" | "warning" | "neutral" } {
  if (progress.remainingQty <= RECEIVING_EPSILON) {
    return { label: "已全部处理", tone: "success" };
  }
  if (progress.processedQty > RECEIVING_EPSILON) {
    return { label: "部分验收", tone: "warning" };
  }
  return { label: "待验收", tone: "neutral" };
}
