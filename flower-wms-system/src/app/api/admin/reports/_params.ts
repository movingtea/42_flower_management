import type { ReportPreset } from "@/services/business-report-pure";

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
    sortBy:
      sortBy === "grossProfit" ||
      sortBy === "grossMargin" ||
      sortBy === "paidAmount" ||
      sortBy === "orderQuantity"
        ? sortBy
        : undefined,
  };
}
