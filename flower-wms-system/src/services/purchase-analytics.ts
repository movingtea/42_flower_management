import { Prisma } from "@/generated/prisma/client";
import {
  PurchaseOrderStatus,
  StockLogType,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { decimalToString, money } from "@/services/order-cost-pure";
import { getReportDateRange } from "@/services/business-report-pure";
import {
  buildPurchaseRecommendationTags,
  calculateBatchCostContribution,
  calculateBatchSalesConversion,
  calculateFlowerPurchasePriceTrends,
  calculatePurchaseAnalyticsSummary,
  calculateSupplierPurchaseRanking,
  getEffectivePurchaseDate,
  PURCHASE_TAG_LABELS,
  type BatchAnalyticsRow,
  type PurchaseLineAnalyticsRow,
  type PurchaseOrderAnalyticsRow,
  type PurchaseRecommendationTag,
  type StockLogAnalyticsRow,
} from "@/services/purchase-analytics-pure";

const DEFAULT_LIMIT = 20;

export type PurchaseAnalyticsParams = {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  supplierId?: string | null;
  flowerWikiId?: string | null;
  limit?: number | string | null;
  includeDraft?: boolean | string | null;
  now?: Date;
};

type DateRangeDto = {
  startDate: string;
  endDate: string;
  label: string;
};

type TagDto = {
  key: PurchaseRecommendationTag;
  label: string;
};

function moneyString(value: Prisma.Decimal | number | string | null | undefined): string {
  return decimalToString(money(value));
}

function unitCostString(value: Prisma.Decimal | number | string | null | undefined): string {
  return decimalToString(new Prisma.Decimal(value ?? 0), 4);
}

function serializeTags(tags: PurchaseRecommendationTag[]): TagDto[] {
  return tags.map((key) => ({ key, label: PURCHASE_TAG_LABELS[key] }));
}

function serializeRange(range: { startDate: Date; endDate: Date; label: string }): DateRangeDto {
  return {
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    label: range.label,
  };
}

function safeLimit(limit: PurchaseAnalyticsParams["limit"], fallback = DEFAULT_LIMIT): number {
  const value = Number(limit ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), 100);
}

function parseIncludeDraft(value: PurchaseAnalyticsParams["includeDraft"]): boolean {
  if (value === true || value === "true" || value === "1") return true;
  return false;
}

function buildReceivedPurchaseOrderWhere(
  range: { startDate: Date; endDate: Date },
  supplierId?: string | null,
  flowerWikiId?: string | null
): Prisma.PurchaseOrderWhereInput {
  const dateFilter: Prisma.PurchaseOrderWhereInput = {
    OR: [
      {
        receivedAt: {
          gte: range.startDate,
          lt: range.endDate,
        },
      },
      {
        receivedAt: null,
        purchaseDate: {
          gte: range.startDate,
          lt: range.endDate,
        },
      },
      {
        receivedAt: null,
        createdAt: {
          gte: range.startDate,
          lt: range.endDate,
        },
      },
    ],
  };

  const where: Prisma.PurchaseOrderWhereInput = {
    status: PurchaseOrderStatus.RECEIVED,
    ...dateFilter,
  };

  if (supplierId) {
    where.supplierId = supplierId;
  }

  if (flowerWikiId) {
    where.lines = { some: { flowerWikiId } };
  }

  return where;
}

function buildPendingPurchaseOrderWhere(
  range: { startDate: Date; endDate: Date },
  supplierId?: string | null,
  flowerWikiId?: string | null
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {
    status: { in: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ORDERED] },
    purchaseDate: {
      gte: range.startDate,
      lt: range.endDate,
    },
  };

  if (supplierId) {
    where.supplierId = supplierId;
  }

  if (flowerWikiId) {
    where.lines = { some: { flowerWikiId } };
  }

  return where;
}

const purchaseOrderSelect = {
  id: true,
  purchaseNo: true,
  supplierId: true,
  status: true,
  purchaseDate: true,
  receivedAt: true,
  createdAt: true,
  goodsAmount: true,
  totalExtraFee: true,
  totalAmount: true,
  supplier: {
    select: {
      id: true,
      name: true,
      supplierType: true,
    },
  },
} as const;

const purchaseLineSelect = {
  id: true,
  purchaseOrderId: true,
  flowerWikiId: true,
  purchaseQuantity: true,
  stemsPerUnit: true,
  totalStems: true,
  unitPrice: true,
  lineAmount: true,
  allocatedExtraFee: true,
  actualTotalCost: true,
  actualUnitCost: true,
  usableRate: true,
  lossRate: true,
  lossAdjustedTotalCost: true,
  lossAdjustedUnitCost: true,
  inboundBatchId: true,
  flowerWiki: {
    select: {
      id: true,
      chineseName: true,
    },
  },
} as const;

function mapPurchaseOrderRow(
  row: Prisma.PurchaseOrderGetPayload<{ select: typeof purchaseOrderSelect }>
): PurchaseOrderAnalyticsRow {
  return {
    id: row.id,
    purchaseNo: row.purchaseNo,
    supplierId: row.supplierId,
    status: row.status,
    purchaseDate: row.purchaseDate,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    goodsAmount: row.goodsAmount,
    totalExtraFee: row.totalExtraFee,
    totalAmount: row.totalAmount,
    supplier: row.supplier,
  };
}

function mapPurchaseLineRow(
  line: Prisma.PurchaseOrderLineGetPayload<{ select: typeof purchaseLineSelect }>,
  order: PurchaseOrderAnalyticsRow
): PurchaseLineAnalyticsRow {
  return {
    ...line,
    purchaseOrder: order,
  };
}

export async function getPurchaseAnalyticsReport(params: PurchaseAnalyticsParams = {}) {
  const range = getReportDateRange({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
    now: params.now,
  });
  const limit = safeLimit(params.limit);
  const includeDraft = parseIncludeDraft(params.includeDraft);
  const globalWarnings: string[] = [
    "采购复盘优先按采购单到货时间统计；缺少到货时间的已入库单会回退到采购日期或创建时间",
  ];

  const receivedWhere = buildReceivedPurchaseOrderWhere(
    range,
    params.supplierId,
    params.flowerWikiId
  );

  const [receivedOrdersRaw, pendingOrdersRaw] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: receivedWhere,
      select: {
        ...purchaseOrderSelect,
        lines: {
          where: params.flowerWikiId ? { flowerWikiId: params.flowerWikiId } : undefined,
          select: purchaseLineSelect,
        },
      },
      orderBy: [{ receivedAt: "desc" }, { purchaseDate: "desc" }],
    }),
    includeDraft
      ? prisma.purchaseOrder.findMany({
          where: buildPendingPurchaseOrderWhere(
            range,
            params.supplierId,
            params.flowerWikiId
          ),
          select: purchaseOrderSelect,
          orderBy: { purchaseDate: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const receivedPurchaseOrders = receivedOrdersRaw.map(mapPurchaseOrderRow);
  const pendingPurchaseOrders = pendingOrdersRaw.map(mapPurchaseOrderRow);

  const purchaseLines: PurchaseLineAnalyticsRow[] = [];
  for (const order of receivedOrdersRaw) {
    const mappedOrder = mapPurchaseOrderRow(order);
    for (const line of order.lines) {
      purchaseLines.push(mapPurchaseLineRow(line, mappedOrder));
    }
  }

  const batchIds = [
    ...new Set(
      purchaseLines
        .map((line) => line.inboundBatchId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [batchesRaw, stockLogsRaw] = await Promise.all([
    batchIds.length > 0
      ? prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true,
            batchNo: true,
            materialId: true,
            originalQty: true,
            remainingQty: true,
            unitCost: true,
            lossAdjustedUnitCost: true,
            usableRate: true,
            lossRate: true,
            supplier: true,
            inboundAt: true,
            createdAt: true,
            material: {
              select: {
                wikiId: true,
                wiki: {
                  select: {
                    chineseName: true,
                  },
                },
                name: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    batchIds.length > 0
      ? prisma.stockLog.findMany({
          where: {
            batchId: { in: batchIds },
            type: {
              in: [
                StockLogType.SALE_OUT,
                StockLogType.WASTAGE_OUT,
                StockLogType.IN_CANCEL,
                StockLogType.ADJUSTMENT,
              ],
            },
          },
          select: {
            id: true,
            materialId: true,
            batchId: true,
            orderId: true,
            orderItemId: true,
            type: true,
            quantity: true,
            delta: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const batches: BatchAnalyticsRow[] = batchesRaw.map((batch) => ({
    id: batch.id,
    batchNo: batch.batchNo,
    materialId: batch.materialId,
    originalQty: batch.originalQty,
    remainingQty: batch.remainingQty,
    unitCost: batch.unitCost,
    lossAdjustedUnitCost: batch.lossAdjustedUnitCost,
    usableRate: batch.usableRate,
    lossRate: batch.lossRate,
    supplier: batch.supplier,
    inboundAt: batch.inboundAt,
    createdAt: batch.createdAt,
    flowerWikiId: batch.material.wikiId,
    flowerName: batch.material.wiki?.chineseName ?? batch.material.name,
  }));

  const stockLogs: StockLogAnalyticsRow[] = stockLogsRaw.map((log) => ({
    id: log.id,
    materialId: log.materialId,
    batchId: log.batchId,
    orderId: log.orderId,
    orderItemId: log.orderItemId,
    type: log.type,
    quantity: log.quantity,
    delta: log.delta,
    createdAt: log.createdAt,
  }));

  const summary = calculatePurchaseAnalyticsSummary({
    receivedPurchaseOrders,
    purchaseLines,
    batches,
    dateRange: range,
    pendingPurchaseOrders: includeDraft ? pendingPurchaseOrders : undefined,
  });

  const supplierRanking = calculateSupplierPurchaseRanking({
    receivedPurchaseOrders,
    purchaseLines,
    limit,
  });

  const flowerPriceTrends = calculateFlowerPurchasePriceTrends({
    purchaseLines,
    limit,
  });

  const batchSalesConversion = calculateBatchSalesConversion({
    batches,
    stockLogs,
    now: params.now,
  });

  const batchCostContribution = calculateBatchCostContribution({
    batches,
    stockLogs,
  });

  const recommendationTags = buildPurchaseRecommendationTags({
    supplierRanking,
    flowerPriceTrends,
    batchSalesConversion,
  });

  if (receivedPurchaseOrders.length === 0) {
    globalWarnings.push("所选期间没有已入库采购单，采购复盘数据为空");
  }

  return {
    dateRange: serializeRange(range),
    summary: {
      purchaseAmount: moneyString(summary.purchaseAmount),
      purchaseOrderCount: summary.purchaseOrderCount,
      receivedPurchaseOrderCount: summary.receivedPurchaseOrderCount,
      supplierCount: summary.supplierCount,
      batchCount: summary.batchCount,
      totalInboundStems: summary.totalInboundStems.toFixed(2),
      averagePurchaseOrderAmount: moneyString(summary.averagePurchaseOrderAmount),
      rawPurchaseCost: moneyString(summary.rawPurchaseCost),
      lossAdjustedPurchaseCost: moneyString(summary.lossAdjustedPurchaseCost),
      lossModelExtraCost: moneyString(summary.lossModelExtraCost),
      averageActualUnitCost:
        summary.averageActualUnitCost !== null
          ? unitCostString(summary.averageActualUnitCost)
          : null,
      averageLossAdjustedUnitCost:
        summary.averageLossAdjustedUnitCost !== null
          ? unitCostString(summary.averageLossAdjustedUnitCost)
          : null,
      pendingPurchaseAmount:
        summary.pendingPurchaseAmount !== undefined
          ? moneyString(summary.pendingPurchaseAmount)
          : undefined,
      pendingPurchaseOrderCount: summary.pendingPurchaseOrderCount,
      warnings: summary.warnings,
    },
    supplierRanking: supplierRanking.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      supplierType: row.supplierType,
      purchaseAmount: moneyString(row.purchaseAmount),
      purchaseOrderCount: row.purchaseOrderCount,
      lineCount: row.lineCount,
      inboundStems: row.inboundStems.toFixed(2),
      rawPurchaseCost: moneyString(row.rawPurchaseCost),
      lossAdjustedPurchaseCost: moneyString(row.lossAdjustedPurchaseCost),
      lossModelExtraCost: moneyString(row.lossModelExtraCost),
      averageActualUnitCost:
        row.averageActualUnitCost !== null
          ? unitCostString(row.averageActualUnitCost)
          : null,
      averageLossAdjustedUnitCost:
        row.averageLossAdjustedUnitCost !== null
          ? unitCostString(row.averageLossAdjustedUnitCost)
          : null,
      lossImpactRate: row.lossImpactRate,
      latestPurchaseDate: row.latestPurchaseDate?.toISOString() ?? null,
      tags: serializeTags(row.tags),
      warnings: row.warnings,
    })),
    flowerPriceTrends: flowerPriceTrends.map((row) => ({
      flowerWikiId: row.flowerWikiId,
      flowerName: row.flowerName,
      latestPurchaseDate: row.latestPurchaseDate?.toISOString() ?? null,
      latestSupplierName: row.latestSupplierName,
      latestActualUnitCost:
        row.latestActualUnitCost !== null
          ? unitCostString(row.latestActualUnitCost)
          : null,
      previousActualUnitCost:
        row.previousActualUnitCost !== null
          ? unitCostString(row.previousActualUnitCost)
          : null,
      actualUnitCostChange:
        row.actualUnitCostChange !== null
          ? unitCostString(row.actualUnitCostChange)
          : null,
      actualUnitCostChangeRate: row.actualUnitCostChangeRate,
      latestLossAdjustedUnitCost:
        row.latestLossAdjustedUnitCost !== null
          ? unitCostString(row.latestLossAdjustedUnitCost)
          : null,
      previousLossAdjustedUnitCost:
        row.previousLossAdjustedUnitCost !== null
          ? unitCostString(row.previousLossAdjustedUnitCost)
          : null,
      lossAdjustedUnitCostChange:
        row.lossAdjustedUnitCostChange !== null
          ? unitCostString(row.lossAdjustedUnitCostChange)
          : null,
      lossAdjustedUnitCostChangeRate: row.lossAdjustedUnitCostChangeRate,
      purchaseCount: row.purchaseCount,
      totalStems: row.totalStems.toFixed(2),
      lossImpactRate: row.lossImpactRate,
      tags: serializeTags(row.tags),
      warnings: row.warnings,
    })),
    batchSalesConversion: batchSalesConversion.map((row) => ({
      batchId: row.batchId,
      batchNo: row.batchNo,
      materialId: row.materialId,
      flowerWikiId: row.flowerWikiId,
      flowerName: row.flowerName,
      supplierName: row.supplierName,
      inboundDate: row.inboundDate.toISOString(),
      originalQty: row.originalQty,
      remainingQty: row.remainingQty,
      soldQty: row.soldQty,
      wastageQty: row.wastageQty,
      cancelReturnQty: row.cancelReturnQty,
      adjustmentQty: row.adjustmentQty,
      salesConversionRate: row.salesConversionRate,
      actualWastageRate: row.actualWastageRate,
      remainingRate: row.remainingRate,
      rawCost: moneyString(row.rawCost),
      lossAdjustedCost: moneyString(row.lossAdjustedCost),
      tags: serializeTags(row.tags),
      warnings: row.warnings,
    })),
    batchCostContribution: batchCostContribution.map((row) => ({
      batchId: row.batchId,
      batchNo: row.batchNo,
      flowerWikiId: row.flowerWikiId,
      flowerName: row.flowerName,
      supplierName: row.supplierName,
      soldQty: row.soldQty,
      orderCount: row.orderCount,
      rawCostContribution: moneyString(row.rawCostContribution),
      lossAdjustedCostContribution: moneyString(row.lossAdjustedCostContribution),
      lossModelExtraCost: moneyString(row.lossModelExtraCost),
      averageRawUnitCost:
        row.averageRawUnitCost !== null ? unitCostString(row.averageRawUnitCost) : null,
      averageLossAdjustedUnitCost:
        row.averageLossAdjustedUnitCost !== null
          ? unitCostString(row.averageLossAdjustedUnitCost)
          : null,
      tags: serializeTags(row.tags),
      warnings: row.warnings,
    })),
    recommendationTags: {
      suppliers: recommendationTags.suppliers.map((row) => ({
        ...row,
        tags: serializeTags(row.tags),
      })),
      flowers: recommendationTags.flowers.map((row) => ({
        ...row,
        tags: serializeTags(row.tags),
      })),
      batches: recommendationTags.batches.map((row) => ({
        ...row,
        tags: serializeTags(row.tags),
      })),
    },
    warnings: globalWarnings,
    meta: {
      effectiveDateField: "receivedAt",
      fallbackDateFields: ["purchaseDate", "createdAt"],
      includedStatuses: [PurchaseOrderStatus.RECEIVED],
      includeDraft,
      latestPurchaseSampleDate:
        receivedPurchaseOrders[0]
          ? getEffectivePurchaseDate(receivedPurchaseOrders[0]).toISOString()
          : null,
    },
  };
}
