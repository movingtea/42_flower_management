import type { ReportPreset } from "@/services/business-report-pure";

type ProductRankingSortBy =
  | "grossProfit"
  | "grossMargin"
  | "paidAmount"
  | "orderQuantity";

function parseSortBy(value: string | null): ProductRankingSortBy | undefined {
  if (
    value === "grossProfit" ||
    value === "grossMargin" ||
    value === "paidAmount" ||
    value === "orderQuantity"
  ) {
    return value;
  }
  return undefined;
}

export function parseReportSearchParams(searchParams: URLSearchParams) {
  const preset = searchParams.get("preset") as ReportPreset | null;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const lowMarginThreshold = searchParams.get("lowMarginThreshold");
  const limit = searchParams.get("limit");
  const sortBy = searchParams.get("sortBy");

  return {
    preset,
    startDate,
    endDate,
    lowMarginThreshold,
    limit,
    sortBy: parseSortBy(sortBy),
  };
}
