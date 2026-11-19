import { isReportTab, REPORT_PRESETS, type ReportTab } from "@/v2/domain/reporting";

export type ReportSearchParams = {
  tab?: string | string[];
  preset?: string | string[];
  startDate?: string | string[];
  endDate?: string | string[];
  threshold?: string | string[];
};

export type ReportFilters = {
  tab: ReportTab;
  preset: string;
  startDate?: string;
  endDate?: string;
  threshold: number;
};

export const DEFAULT_LOW_MARGIN_THRESHOLD = 0.35;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function dateKey(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    const [, month, day] = value.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function parseReportThreshold(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_LOW_MARGIN_THRESHOLD;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LOW_MARGIN_THRESHOLD;
  return Math.min(1, Math.max(0, parsed));
}

export function parseReportFilters(params: ReportSearchParams): ReportFilters {
  const tab = single(params.tab);
  const preset = single(params.preset);
  return {
    tab: isReportTab(tab) ? tab : "overview",
    preset: (REPORT_PRESETS as readonly string[]).includes(preset ?? "")
      ? (preset as string)
      : "thisMonth",
    startDate: dateKey(single(params.startDate)),
    endDate: dateKey(single(params.endDate)),
    threshold: parseReportThreshold(single(params.threshold)),
  };
}

export function buildReportQuery(filters: ReportFilters, overrides: Partial<ReportFilters> = {}): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.tab !== "overview") params.set("tab", next.tab);
  if (next.startDate || next.endDate) {
    if (next.startDate) params.set("startDate", next.startDate);
    if (next.endDate) params.set("endDate", next.endDate);
  } else if (next.preset !== "thisMonth") {
    params.set("preset", next.preset);
  }
  if (next.threshold !== DEFAULT_LOW_MARGIN_THRESHOLD) {
    params.set("threshold", String(next.threshold));
  }
  return params.toString();
}

export function buildReportHref(filters: ReportFilters, overrides: Partial<ReportFilters> = {}): string {
  const query = buildReportQuery(filters, overrides);
  return query ? `/v2/reports?${query}` : "/v2/reports";
}
