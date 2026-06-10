export type {
  ProductDecisionActualPerformance,
  ProductDecisionCostStructure,
  ProductDecisionHealth,
  ProductDecisionItem,
  ProductDecisionLossSensitivity,
  ProductDecisionMarginEstimates,
  ProductDecisionReport,
  ProductDecisionSales,
  ProductDecisionSummary,
} from "@/services/product-decision";

export type ProductDecisionTagDto = {
  key: string;
  label: string;
  reason: string;
  severity: "success" | "info" | "warning" | "danger" | "neutral";
};

export type ProductDecisionApiResponse = {
  success: boolean;
  data?: import("@/services/product-decision").ProductDecisionReport;
  error?: string;
};
