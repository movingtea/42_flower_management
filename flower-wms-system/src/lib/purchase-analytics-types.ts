import type { PurchaseAnalyticsTag } from "@/lib/purchase-analytics-tags";

export type PurchaseAnalyticsDateRange = {
  startDate: string;
  endDate: string;
  label: string;
};

export type PurchaseAnalyticsSummaryDto = {
  purchaseAmount: string;
  purchaseOrderCount: number;
  receivedPurchaseOrderCount: number;
  supplierCount: number;
  batchCount: number;
  totalInboundStems: string;
  averagePurchaseOrderAmount: string;
  rawPurchaseCost: string;
  lossAdjustedPurchaseCost: string;
  lossModelExtraCost: string;
  averageActualUnitCost: string | null;
  averageLossAdjustedUnitCost: string | null;
  pendingPurchaseAmount?: string;
  pendingPurchaseOrderCount?: number;
  warnings: string[];
};

export type PurchaseAnalyticsSupplierRow = {
  supplierId: string;
  supplierName: string;
  supplierType: string;
  purchaseAmount: string;
  purchaseOrderCount: number;
  lineCount: number;
  inboundStems: string;
  rawPurchaseCost: string;
  lossAdjustedPurchaseCost: string;
  lossModelExtraCost: string;
  averageActualUnitCost: string | null;
  averageLossAdjustedUnitCost: string | null;
  lossImpactRate: number | null;
  latestPurchaseDate: string | null;
  tags: PurchaseAnalyticsTag[];
  warnings: string[];
};

export type PurchaseAnalyticsFlowerTrendRow = {
  flowerWikiId: string;
  flowerName: string;
  latestPurchaseDate: string | null;
  latestSupplierName: string | null;
  latestActualUnitCost: string | null;
  previousActualUnitCost: string | null;
  actualUnitCostChange: string | null;
  actualUnitCostChangeRate: number | null;
  latestLossAdjustedUnitCost: string | null;
  previousLossAdjustedUnitCost: string | null;
  lossAdjustedUnitCostChange: string | null;
  lossAdjustedUnitCostChangeRate: number | null;
  purchaseCount: number;
  totalStems: string;
  lossImpactRate: number | null;
  tags: PurchaseAnalyticsTag[];
  warnings: string[];
};

export type PurchaseAnalyticsBatchConversionRow = {
  batchId: string;
  batchNo: string | null;
  materialId: string;
  flowerWikiId: string | null;
  flowerName: string;
  supplierName: string | null;
  inboundDate: string;
  originalQty: number;
  remainingQty: number;
  soldQty: number;
  wastageQty: number;
  cancelReturnQty: number;
  adjustmentQty: number;
  salesConversionRate: number | null;
  actualWastageRate: number | null;
  remainingRate: number | null;
  rawCost: string;
  lossAdjustedCost: string;
  tags: PurchaseAnalyticsTag[];
  warnings: string[];
};

export type PurchaseAnalyticsBatchCostRow = {
  batchId: string;
  batchNo: string | null;
  flowerWikiId: string | null;
  flowerName: string;
  supplierName: string | null;
  soldQty: number;
  orderCount: number;
  rawCostContribution: string;
  lossAdjustedCostContribution: string;
  lossModelExtraCost: string;
  averageRawUnitCost: string | null;
  averageLossAdjustedUnitCost: string | null;
  tags: PurchaseAnalyticsTag[];
  warnings: string[];
};

export type PurchaseAnalyticsRecommendationTags = {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    tags: PurchaseAnalyticsTag[];
  }>;
  flowers: Array<{
    flowerWikiId: string;
    flowerName: string;
    tags: PurchaseAnalyticsTag[];
  }>;
  batches: Array<{
    batchId: string;
    batchNo: string | null;
    flowerName: string;
    tags: PurchaseAnalyticsTag[];
  }>;
};

export type PurchaseAnalyticsReport = {
  dateRange: PurchaseAnalyticsDateRange;
  summary: PurchaseAnalyticsSummaryDto;
  supplierRanking: PurchaseAnalyticsSupplierRow[];
  flowerPriceTrends: PurchaseAnalyticsFlowerTrendRow[];
  batchSalesConversion: PurchaseAnalyticsBatchConversionRow[];
  batchCostContribution: PurchaseAnalyticsBatchCostRow[];
  recommendationTags: PurchaseAnalyticsRecommendationTags;
  warnings: string[];
};
