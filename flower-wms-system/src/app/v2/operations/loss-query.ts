import type { LossReason, Prisma } from "@/generated/prisma-v2/client";
import { getAppDateKey, getAppDayRangeUtc } from "../../../lib/datetime";
import { LOSS_REASON_OPTIONS } from "./labels";

/** Loss history rows shown per page. */
export const LOSS_PAGE_SIZE = 20;

export const LOSS_REVIEW_STATUS_OPTIONS = [
  { value: "PENDING", label: "待复核" },
  { value: "APPROVED", label: "已通过" },
  { value: "REJECTED", label: "已拒绝" },
] as const;

export type LossReviewStatus = (typeof LOSS_REVIEW_STATUS_OPTIONS)[number]["value"];

export type LossQueryFilters = {
  reason?: LossReason;
  reviewStatus?: LossReviewStatus;
  from?: string;
  to?: string;
};

export type LossSearchParams = Record<string, string | string[] | undefined>;

export type LossQueryFeedback = {
  message?: string;
  error?: string;
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * Accept a real Shanghai calendar date and reject impossible values such as
 * 2026-02-30 that Date.UTC would silently roll into the next month.
 */
function normalizeDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    if (getAppDateKey(getAppDayRangeUtc(value).startUtc) !== value) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Allowlist reason/reviewStatus and ignore invalid or repeated query values. */
export function normalizeLossFilters(params: LossSearchParams): LossQueryFilters {
  const reason = single(params.reason);
  const reviewStatus = single(params.reviewStatus);
  return {
    reason: reason && LOSS_REASON_OPTIONS.includes(reason as LossReason)
      ? reason as LossReason
      : undefined,
    reviewStatus: LOSS_REVIEW_STATUS_OPTIONS.some((option) => option.value === reviewStatus)
      ? reviewStatus as LossReviewStatus
      : undefined,
    from: normalizeDate(single(params.from)),
    to: normalizeDate(single(params.to)),
  };
}

/** Accept only a positive integer; anything else falls back to the first page. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function lossTotalPages(total: number, pageSize: number = LOSS_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampLossPage(page: number, total: number, pageSize: number = LOSS_PAGE_SIZE): number {
  const pages = lossTotalPages(total, pageSize);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), pages);
}

/** Build the Prisma filter for the loss history; dates are inclusive Shanghai days. */
export function buildLossWhere(storeId: string, filters: LossQueryFilters): Prisma.LossRecordWhereInput {
  const where: Prisma.LossRecordWhereInput = { storeId };
  if (filters.reason) where.reason = filters.reason;
  if (filters.reviewStatus) where.reviewStatus = filters.reviewStatus;

  const occurredAt: Prisma.DateTimeFilter = {};
  if (filters.from) occurredAt.gte = getAppDayRangeUtc(filters.from).startUtc;
  if (filters.to) occurredAt.lt = getAppDayRangeUtc(filters.to).endUtcExclusive;
  if (occurredAt.gte || occurredAt.lt) where.occurredAt = occurredAt;
  return where;
}

/**
 * Loss history href. Filters, the active page and any action feedback survive
 * pagination, and the anchor returns the operator to the loss history section.
 */
export function buildLossHref(
  filters: LossQueryFilters,
  page: number,
  feedback?: LossQueryFeedback,
): string {
  const params = new URLSearchParams();
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (feedback?.message) params.set("message", feedback.message);
  if (feedback?.error) params.set("error", feedback.error);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/v2/operations?${query}#loss-history` : "/v2/operations#loss-history";
}

export function lossPageNumbers(current: number, total: number, radius: number = 2): number[] {
  const pages = Math.max(1, Math.floor(total));
  const active = Math.min(Math.max(1, Math.floor(current)), pages);
  const first = Math.max(1, active - Math.max(0, Math.floor(radius)));
  const last = Math.min(pages, active + Math.max(0, Math.floor(radius)));
  const numbers: number[] = [];
  for (let page = first; page <= last; page += 1) numbers.push(page);
  return numbers;
}

export function lossReviewStatusLabel(status: string | null | undefined): string {
  if (!status) return "未复核";
  return LOSS_REVIEW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}
