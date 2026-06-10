import { Prisma } from "@/generated/prisma/client";
import {
  OrderCancelSource,
  OrderStatus,
  StockLogType,
} from "@/generated/prisma/enums";
import {
  getAppDateKey,
  listAppDateKeysInRange,
  serializeReportDateRange,
} from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { upsertOrderCostSnapshot } from "@/services/order-cost";
import { decimalToString, money, ratio, type DecimalInput } from "@/services/order-cost-pure";
import {
  aggregateLossModelImpact,
  calculateCostStructureRatios,
  filterLowMarginRows,
  getReportDateRange,
  ratioString,
  sumSalesSummaryRows,
  type ReportDateRangeParams,
} from "@/services/business-report-pure";

export { getReportDateRange };
export type { ReportDateRangeParams, ReportPreset } from "@/services/business-report-pure";

const EFFECTIVE_ORDER_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.PRODUCTION,
  OrderStatus.DELIVERING,
  OrderStatus.COMPLETED,
] as const;

const DEFAULT_LOW_MARGIN_THRESHOLD = "0.35";
const DEFAULT_RANKING_LIMIT = 20;
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

type BusinessReportParams = ReportDateRangeParams & {
  limit?: number | string | null;
  lowMarginThreshold?: DecimalInput;
  sortBy?: "grossProfit" | "grossMargin" | "paidAmount" | "orderQuantity";
};

type DateRangeDto = {
  startDate: string;
  endDate: string;
  label: string;
};

type MoneyBreakdownDto = {
  totalCost: string;
  flowerMaterialCost: string;
  packagingCost: string;
  deliveryCostActual: string;
  platformFee: string;
  floristLaborCost: string;
  otherCost: string;
};

export type SalesSummaryReport = MoneyBreakdownDto & {
  dateRange: DateRangeDto;
  totalPaidAmount: string;
  orderCount: number;
  paidOrderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  refundedOrderCount: number;
  grossProfit: string;
  grossMargin: string;
  averageOrderValue: string;
  averageGrossProfitPerOrder: string;
  missingSnapshotOrderCount: number;
  missingSnapshotOrderIds: string[];
  warnings: string[];
};

export type DailySalesTrendItem = {
  date: string;
  paidAmount: string;
  orderCount: number;
  totalCost: string;
  grossProfit: string;
  grossMargin: string;
};

export type DailySalesTrendReport = {
  dateRange: DateRangeDto;
  items: DailySalesTrendItem[];
  warnings: string[];
};

export type ProductProfitRankingItem = {
  productId: string;
  productName: string;
  skuId: string;
  skuName: string;
  orderQuantity: number;
  paidAmount: string;
  totalCost: string;
  flowerMaterialCost: string;
  packagingCost: string;
  deliveryCostAllocated: string;
  grossProfit: string;
  grossMargin: string;
};

export type ProductProfitRankingReport = {
  dateRange: DateRangeDto;
  allocationMethod: "ORDER_AMOUNT_RATIO" | "ORDER_ITEM_SALE_OUT_WITH_ORDER_AMOUNT_RATIO";
  items: ProductProfitRankingItem[];
  warnings: string[];
};

export type LowMarginOrderItem = {
  orderId: string;
  orderNo: string;
  paidAmount: string;
  totalCost: string;
  grossProfit: string;
  grossMargin: string;
  flowerMaterialCost: string;
  packagingCost: string;
  deliveryCostActual: string;
  status: OrderStatus;
  createdAt: string;
  warnings: string[];
};

export type LowMarginOrdersReport = {
  dateRange: DateRangeDto;
  threshold: string;
  items: LowMarginOrderItem[];
  missingCostOrders: Array<{
    orderId: string;
    orderNo: string;
    paidAmount: string;
    status: OrderStatus;
    createdAt: string;
    warnings: string[];
  }>;
};

export type CostStructureReport = MoneyBreakdownDto & {
  dateRange: DateRangeDto;
  ratios: {
    flowerMaterialCostRatio: string;
    packagingCostRatio: string;
    deliveryCostRatio: string;
    platformFeeRatio: string;
    floristLaborCostRatio: string;
    otherCostRatio: string;
  };
};

export type MaterialUsageCostReport = {
  dateRange: DateRangeDto;
  items: Array<{
    flowerWikiId: string;
    flowerName: string;
    quantityUsed: number;
    totalCost: string;
    avgUnitCost: string;
    orderCount: number;
  }>;
  note: string;
};

export type WastageReport = {
  dateRange: DateRangeDto;
  items: Array<{
    flowerWikiId: string;
    flowerName: string;
    lossQuantity: number;
    estimatedLossCost: string;
    lossCount: number;
    topReasons: Array<{ reason: string; count: number; quantity: number }>;
  }>;
  totalLossQuantity: number;
  totalEstimatedLossCost: string;
};

export type InventoryAlertReport = {
  lowStockThreshold: number;
  items: Array<{
    flowerWikiId: string;
    flowerName: string;
    remainingQty: number;
    inventoryValue: string;
    activeBatchCount: number;
    oldestInboundAt: string | null;
    latestInboundAt: string | null;
    alertLevel: "OUT_OF_STOCK" | "LOW" | "NORMAL";
    reason: string;
  }>;
};

export type LossModelImpactReport = {
  dateRange: DateRangeDto;
  rawFlowerMaterialCost: string;
  lossAdjustedFlowerMaterialCost: string;
  lossModelExtraCost: string;
  lossModelExtraCostRatioToSales: string;
  topMaterialsByLossImpact: Array<{
    flowerWikiId: string;
    flowerName: string;
    quantityUsed: number;
    rawCost: string;
    lossAdjustedCost: string;
    lossModelExtraCost: string;
    avgUsableRate: string | null;
  }>;
  warnings: string[];
};

export type BusinessDashboardReport = {
  summary: SalesSummaryReport;
  dailySalesTrend: DailySalesTrendReport;
  productProfitRanking: ProductProfitRankingReport;
  lowMarginOrders: LowMarginOrdersReport;
  costStructure: CostStructureReport;
  materialUsage: MaterialUsageCostReport;
  wastage: WastageReport;
  inventoryAlerts: InventoryAlertReport;
  lossModelImpact: LossModelImpactReport;
  warnings: string[];
};

function serializeRange(range: { startDate: Date; endDate: Date; label: string }): DateRangeDto {
  return serializeReportDateRange(range);
}

function moneyString(value: DecimalInput): string {
  return decimalToString(money(value));
}

function safeLimit(limit: BusinessReportParams["limit"], fallback = DEFAULT_RANKING_LIMIT): number {
  const value = Number(limit ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), 100);
}

function reportOrderDateWhere(startDate: Date, endDate: Date): Prisma.OrderWhereInput {
  return {
    OR: [
      { paidAt: { gte: startDate, lt: endDate } },
      { paidAt: null, createdAt: { gte: startDate, lt: endDate } },
    ],
  };
}

function nonRefundedWhere(): Prisma.OrderWhereInput {
  return {
    refundTime: null,
    OR: [{ refundAmount: null }, { refundAmount: { lte: 0 } }],
  };
}

function refundedWhere(): Prisma.OrderWhereInput {
  return {
    OR: [
      { refundTime: { not: null } },
      { refundAmount: { gt: 0 } },
      { cancelSource: OrderCancelSource.REFUND },
    ],
  };
}

function effectiveOrderWhere(startDate: Date, endDate: Date): Prisma.OrderWhereInput {
  return {
    AND: [
      reportOrderDateWhere(startDate, endDate),
      { status: { in: [...EFFECTIVE_ORDER_STATUSES] } },
      nonRefundedWhere(),
    ],
  };
}

function serializeSummary(
  dateRange: DateRangeDto,
  totals: ReturnType<typeof sumSalesSummaryRows>
): SalesSummaryReport {
  return {
    dateRange,
    totalPaidAmount: moneyString(totals.totalPaidAmount),
    orderCount: totals.orderCount,
    paidOrderCount: totals.paidOrderCount,
    completedOrderCount: totals.completedOrderCount,
    cancelledOrderCount: totals.cancelledOrderCount,
    refundedOrderCount: totals.refundedOrderCount,
    totalCost: moneyString(totals.totalCost),
    flowerMaterialCost: moneyString(totals.flowerMaterialCost),
    packagingCost: moneyString(totals.packagingCost),
    deliveryCostActual: moneyString(totals.deliveryCostActual),
    platformFee: moneyString(totals.platformFee),
    floristLaborCost: moneyString(totals.floristLaborCost),
    otherCost: moneyString(totals.otherCost),
    grossProfit: moneyString(totals.grossProfit),
    grossMargin: ratioString(totals.grossMargin),
    averageOrderValue: moneyString(totals.averageOrderValue),
    averageGrossProfitPerOrder: moneyString(totals.averageGrossProfitPerOrder),
    missingSnapshotOrderCount: totals.missingSnapshotOrderCount,
    missingSnapshotOrderIds: totals.missingSnapshotOrderIds,
    warnings: totals.warnings,
  };
}

async function listOrdersForSummary(params: BusinessReportParams) {
  const range = getReportDateRange(params);
  const orders = await prisma.order.findMany({
    where: {
      AND: [
        reportOrderDateWhere(range.startDate, range.endDate),
        {
          OR: [
            { status: { in: [...EFFECTIVE_ORDER_STATUSES] } },
            { status: OrderStatus.CANCELLED },
            refundedWhere(),
          ],
        },
      ],
    },
    select: {
      id: true,
      status: true,
      payAmount: true,
      refundAmount: true,
      refundTime: true,
      cancelSource: true,
      costSnapshot: {
        select: {
          paidAmount: true,
          flowerMaterialCost: true,
          packagingCost: true,
          deliveryCostActual: true,
          platformFee: true,
          floristLaborCost: true,
          otherCost: true,
          totalCost: true,
        },
      },
    },
  });

  const rows = orders.map((order) => {
    const isRefunded =
      Boolean(order.refundTime) ||
      Number(order.refundAmount ?? 0) > 0 ||
      order.cancelSource === OrderCancelSource.REFUND;
    return {
      id: order.id,
      paidAmount: order.payAmount,
      status: order.status,
      isEffective:
        EFFECTIVE_ORDER_STATUSES.includes(order.status as (typeof EFFECTIVE_ORDER_STATUSES)[number]) &&
        !isRefunded,
      isRefunded,
      hasSnapshot: Boolean(order.costSnapshot),
      snapshot: order.costSnapshot,
    };
  });

  return { range, rows };
}

/**
 * 经营报表 MVP 的订单口径：
 * 1. PENDING_PAYMENT 不计入销售额。
 * 2. PAID / PRODUCTION / DELIVERING / COMPLETED 且无退款信息的订单计入销售额与毛利。
 * 3. 如果 refundTime / refundAmount / cancelSource=REFUND 可识别，则默认不计入有效销售额。
 * 4. CANCELLED 只做数量统计；已支付退款取消计入 refundedOrderCount。
 * 5. OrderCostSnapshot 是历史毛利依据，报表不会因后续标准成本或包装方案变更重算历史成本。
 */
export async function getSalesSummaryReport(
  params: BusinessReportParams = {}
): Promise<SalesSummaryReport> {
  const { range, rows } = await listOrdersForSummary(params);
  return serializeSummary(serializeRange(range), sumSalesSummaryRows(rows));
}

export async function getDailySalesTrend(
  params: BusinessReportParams = {}
): Promise<DailySalesTrendReport> {
  const range = getReportDateRange(params);
  const orders = await prisma.order.findMany({
    where: effectiveOrderWhere(range.startDate, range.endDate),
    select: {
      id: true,
      payAmount: true,
      paidAt: true,
      createdAt: true,
      costSnapshot: {
        select: {
          paidAmount: true,
          totalCost: true,
        },
      },
    },
  });

  const days = new Map<string, { paidAmount: Prisma.Decimal; orderCount: number; totalCost: Prisma.Decimal }>();
  for (const key of listAppDateKeysInRange(range.startDate, range.endDate)) {
    days.set(key, {
      paidAmount: money(0),
      orderCount: 0,
      totalCost: money(0),
    });
  }

  let missingSnapshotCount = 0;
  for (const order of orders) {
    const key = getAppDateKey(order.paidAt ?? order.createdAt);
    const bucket =
      days.get(key) ??
      {
        paidAmount: money(0),
        orderCount: 0,
        totalCost: money(0),
      };
    const paidAmount = money(order.costSnapshot?.paidAmount ?? order.payAmount);
    bucket.paidAmount = money(bucket.paidAmount.plus(paidAmount));
    bucket.orderCount += 1;
    if (order.costSnapshot) {
      bucket.totalCost = money(bucket.totalCost.plus(order.costSnapshot.totalCost));
    } else {
      missingSnapshotCount += 1;
    }
    days.set(key, bucket);
  }

  const items = [...days.entries()].map(([date, bucket]) => {
    const grossProfit = money(bucket.paidAmount.minus(bucket.totalCost));
    const grossMargin = bucket.paidAmount.greaterThan(0)
      ? ratio(grossProfit.div(bucket.paidAmount))
      : ratio(0);
    return {
      date,
      paidAmount: moneyString(bucket.paidAmount),
      orderCount: bucket.orderCount,
      totalCost: moneyString(bucket.totalCost),
      grossProfit: moneyString(grossProfit),
      grossMargin: ratioString(grossMargin),
    };
  });

  return {
    dateRange: serializeRange(range),
    items,
    warnings:
      missingSnapshotCount > 0
        ? [`有 ${missingSnapshotCount} 个订单缺少成本快照，对应日期毛利可能偏高。`]
        : [],
  };
}

export async function getProductProfitRanking(
  params: BusinessReportParams = {}
): Promise<ProductProfitRankingReport> {
  const range = getReportDateRange(params);
  const limit = safeLimit(params.limit);
  const sortBy = params.sortBy ?? "grossProfit";
  const orders = await prisma.order.findMany({
    where: effectiveOrderWhere(range.startDate, range.endDate),
    select: {
      id: true,
      payAmount: true,
      costSnapshot: {
        select: {
          paidAmount: true,
          flowerMaterialCost: true,
          packagingCost: true,
          deliveryCostActual: true,
          platformFee: true,
          floristLaborCost: true,
          otherCost: true,
        },
      },
      items: {
        select: {
          id: true,
          skuId: true,
          quantity: true,
          snapshotProductName: true,
          snapshotSpecName: true,
          snapshotPrice: true,
          sku: {
            select: {
              spuId: true,
              recipe: {
                select: {
                  packagingKit: { select: { standardCost: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const orderIds = orders.map((order) => order.id);
  const saleOutLogs =
    orderIds.length > 0
      ? await prisma.stockLog.findMany({
          where: {
            orderId: { in: orderIds },
            orderItemId: { not: null },
            type: StockLogType.SALE_OUT,
          },
          select: {
            orderItemId: true,
            quantity: true,
            batch: { select: { unitCost: true } },
          },
        })
      : [];

  const flowerCostByOrderItem = new Map<string, Prisma.Decimal>();
  for (const log of saleOutLogs) {
    if (!log.orderItemId) continue;
    const lineCost = money(log.batch.unitCost).times(log.quantity);
    flowerCostByOrderItem.set(
      log.orderItemId,
      money((flowerCostByOrderItem.get(log.orderItemId) ?? money(0)).plus(lineCost))
    );
  }

  const groups = new Map<
    string,
    {
      productId: string;
      productName: string;
      skuId: string;
      skuName: string;
      orderQuantity: number;
      paidAmount: Prisma.Decimal;
      totalCost: Prisma.Decimal;
      flowerMaterialCost: Prisma.Decimal;
      packagingCost: Prisma.Decimal;
      deliveryCostAllocated: Prisma.Decimal;
    }
  >();
  let missingSnapshotCount = 0;

  for (const order of orders) {
    const itemSubtotal = order.items.reduce(
      (sum, item) => money(sum.plus(money(item.snapshotPrice).times(item.quantity))),
      money(0)
    );
    const paidAmount = money(order.costSnapshot?.paidAmount ?? order.payAmount);
    const snapshot = order.costSnapshot;
    if (!snapshot) missingSnapshotCount += 1;

    for (const item of order.items) {
      const itemAmount = money(item.snapshotPrice).times(item.quantity);
      const itemRatio =
        itemSubtotal.greaterThan(0) && paidAmount.greaterThan(0)
          ? ratio(itemAmount.div(itemSubtotal))
          : ratio(0);
      const paidAllocated = money(paidAmount.times(itemRatio));
      const allocatedFlower = snapshot ? money(snapshot.flowerMaterialCost).times(itemRatio) : money(0);
      const preciseFlower = flowerCostByOrderItem.get(item.id);
      const flowerMaterialCost = money(preciseFlower ?? allocatedFlower);
      const estimatedPackaging = item.sku.recipe?.packagingKit?.standardCost
        ? money(item.sku.recipe.packagingKit.standardCost).times(item.quantity)
        : snapshot
          ? money(snapshot.packagingCost).times(itemRatio)
          : money(0);
      const packagingCost = money(estimatedPackaging);
      const deliveryCostAllocated = snapshot
        ? money(snapshot.deliveryCostActual).times(itemRatio)
        : money(0);
      const extraAllocated = snapshot
        ? money(snapshot.platformFee)
            .plus(snapshot.floristLaborCost)
            .plus(snapshot.otherCost)
            .times(itemRatio)
        : money(0);
      const totalCost = money(
        flowerMaterialCost.plus(packagingCost).plus(deliveryCostAllocated).plus(extraAllocated)
      );

      const key = `${item.sku.spuId}:${item.skuId}`;
      const current =
        groups.get(key) ??
        {
          productId: item.sku.spuId,
          productName: item.snapshotProductName,
          skuId: item.skuId,
          skuName: item.snapshotSpecName,
          orderQuantity: 0,
          paidAmount: money(0),
          totalCost: money(0),
          flowerMaterialCost: money(0),
          packagingCost: money(0),
          deliveryCostAllocated: money(0),
        };
      current.orderQuantity += item.quantity;
      current.paidAmount = money(current.paidAmount.plus(paidAllocated));
      current.totalCost = money(current.totalCost.plus(totalCost));
      current.flowerMaterialCost = money(current.flowerMaterialCost.plus(flowerMaterialCost));
      current.packagingCost = money(current.packagingCost.plus(packagingCost));
      current.deliveryCostAllocated = money(
        current.deliveryCostAllocated.plus(deliveryCostAllocated)
      );
      groups.set(key, current);
    }
  }

  const items = [...groups.values()].map((item) => {
    const grossProfit = money(item.paidAmount.minus(item.totalCost));
    const grossMargin = item.paidAmount.greaterThan(0)
      ? ratio(grossProfit.div(item.paidAmount))
      : ratio(0);
    return {
      productId: item.productId,
      productName: item.productName,
      skuId: item.skuId,
      skuName: item.skuName,
      orderQuantity: item.orderQuantity,
      paidAmount: moneyString(item.paidAmount),
      totalCost: moneyString(item.totalCost),
      flowerMaterialCost: moneyString(item.flowerMaterialCost),
      packagingCost: moneyString(item.packagingCost),
      deliveryCostAllocated: moneyString(item.deliveryCostAllocated),
      grossProfit: moneyString(grossProfit),
      grossMargin: ratioString(grossMargin),
    };
  });

  items.sort((a, b) => {
    if (sortBy === "orderQuantity") return b.orderQuantity - a.orderQuantity;
    return money(b[sortBy]).comparedTo(money(a[sortBy]));
  });

  return {
    dateRange: serializeRange(range),
    allocationMethod:
      flowerCostByOrderItem.size > 0
        ? "ORDER_ITEM_SALE_OUT_WITH_ORDER_AMOUNT_RATIO"
        : "ORDER_AMOUNT_RATIO",
    items: items.slice(0, limit),
    warnings: [
      "产品毛利排行基于订单项销售额比例分摊订单级成本；若 SALE_OUT 已记录 orderItemId，则花材成本优先按订单项精确归属。",
      ...(missingSnapshotCount > 0
        ? [`有 ${missingSnapshotCount} 个订单缺少成本快照，相关商品成本按 0 处理。`]
        : []),
    ],
  };
}

export async function getLowMarginOrders(
  params: BusinessReportParams = {}
): Promise<LowMarginOrdersReport> {
  const range = getReportDateRange(params);
  const threshold = ratio(params.lowMarginThreshold ?? DEFAULT_LOW_MARGIN_THRESHOLD);
  const orders = await prisma.order.findMany({
    where: effectiveOrderWhere(range.startDate, range.endDate),
    select: {
      id: true,
      orderNo: true,
      status: true,
      payAmount: true,
      createdAt: true,
      costSnapshot: true,
    },
  });

  const missingCostOrders = orders
    .filter((order) => !order.costSnapshot)
    .map((order) => ({
      orderId: order.id,
      orderNo: order.orderNo,
      paidAmount: moneyString(order.payAmount),
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      warnings: ["订单缺少成本快照，暂无法判断真实毛利率。"],
    }));

  const candidates = orders
    .filter((order) => order.costSnapshot)
    .map((order) => {
      const snapshot = order.costSnapshot!;
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        paidAmount: moneyString(snapshot.paidAmount),
        totalCost: moneyString(snapshot.totalCost),
        grossProfit: moneyString(snapshot.grossProfit),
        grossMargin: ratioString(snapshot.grossMargin),
        flowerMaterialCost: moneyString(snapshot.flowerMaterialCost),
        packagingCost: moneyString(snapshot.packagingCost),
        deliveryCostActual: moneyString(snapshot.deliveryCostActual),
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        warnings: [] as string[],
      };
    });

  return {
    dateRange: serializeRange(range),
    threshold: ratioString(threshold),
    items: filterLowMarginRows(candidates, threshold).slice(0, safeLimit(params.limit)),
    missingCostOrders,
  };
}

export async function getCostStructureReport(
  params: BusinessReportParams = {}
): Promise<CostStructureReport> {
  const summary = await getSalesSummaryReport(params);
  const ratios = calculateCostStructureRatios(summary);
  return {
    dateRange: summary.dateRange,
    totalCost: summary.totalCost,
    flowerMaterialCost: summary.flowerMaterialCost,
    packagingCost: summary.packagingCost,
    deliveryCostActual: summary.deliveryCostActual,
    platformFee: summary.platformFee,
    floristLaborCost: summary.floristLaborCost,
    otherCost: summary.otherCost,
    ratios: {
      flowerMaterialCostRatio: ratioString(ratios.flowerMaterialCostRatio),
      packagingCostRatio: ratioString(ratios.packagingCostRatio),
      deliveryCostRatio: ratioString(ratios.deliveryCostRatio),
      platformFeeRatio: ratioString(ratios.platformFeeRatio),
      floristLaborCostRatio: ratioString(ratios.floristLaborCostRatio),
      otherCostRatio: ratioString(ratios.otherCostRatio),
    },
  };
}

export async function getMaterialUsageCostReport(
  params: BusinessReportParams = {}
): Promise<MaterialUsageCostReport> {
  const range = getReportDateRange(params);
  const logs = await prisma.stockLog.findMany({
    where: {
      type: StockLogType.SALE_OUT,
      createdAt: { gte: range.startDate, lt: range.endDate },
    },
    select: {
      quantity: true,
      orderId: true,
      batch: { select: { unitCost: true } },
      material: {
        select: {
          id: true,
          name: true,
          wikiId: true,
          wiki: { select: { chineseName: true } },
        },
      },
    },
  });

  const groups = new Map<
    string,
    {
      flowerWikiId: string;
      flowerName: string;
      quantityUsed: number;
      totalCost: Prisma.Decimal;
      orderIds: Set<string>;
    }
  >();

  for (const log of logs) {
    const key = log.material.wikiId ?? log.material.id;
    const current =
      groups.get(key) ??
      {
        flowerWikiId: key,
        flowerName: log.material.wiki?.chineseName ?? log.material.name,
        quantityUsed: 0,
        totalCost: money(0),
        orderIds: new Set<string>(),
      };
    current.quantityUsed += log.quantity;
    current.totalCost = money(current.totalCost.plus(money(log.batch.unitCost).times(log.quantity)));
    if (log.orderId) current.orderIds.add(log.orderId);
    groups.set(key, current);
  }

  const items = [...groups.values()]
    .map((item) => ({
      flowerWikiId: item.flowerWikiId,
      flowerName: item.flowerName,
      quantityUsed: item.quantityUsed,
      totalCost: moneyString(item.totalCost),
      avgUnitCost:
        item.quantityUsed > 0
          ? moneyString(item.totalCost.div(item.quantityUsed))
          : moneyString(0),
      orderCount: item.orderIds.size,
    }))
    .sort((a, b) => money(b.totalCost).comparedTo(money(a.totalCost)));

  return {
    dateRange: serializeRange(range),
    items,
    note: "花材使用成本按 SALE_OUT 库存流水的 createdAt 统计，不统计 IN_CANCEL；退款订单的历史销售消耗不会被本报表抹掉。",
  };
}

export async function getWastageReport(
  params: BusinessReportParams = {}
): Promise<WastageReport> {
  const range = getReportDateRange(params);
  const records = await prisma.stockLossRecord.findMany({
    where: { createdAt: { gte: range.startDate, lt: range.endDate } },
    select: {
      flowerWikiId: true,
      lossQuantity: true,
      reason: true,
      wiki: { select: { chineseName: true } },
      batch: { select: { unitCost: true } },
    },
  });

  const groups = new Map<
    string,
    {
      flowerWikiId: string;
      flowerName: string;
      lossQuantity: number;
      estimatedLossCost: Prisma.Decimal;
      lossCount: number;
      reasons: Map<string, { count: number; quantity: number }>;
    }
  >();
  let totalLossQuantity = 0;
  let totalEstimatedLossCost = money(0);

  for (const record of records) {
    const current =
      groups.get(record.flowerWikiId) ??
      {
        flowerWikiId: record.flowerWikiId,
        flowerName: record.wiki.chineseName,
        lossQuantity: 0,
        estimatedLossCost: money(0),
        lossCount: 0,
        reasons: new Map<string, { count: number; quantity: number }>(),
      };
    const cost = money(record.batch.unitCost).times(record.lossQuantity);
    current.lossQuantity += record.lossQuantity;
    current.estimatedLossCost = money(current.estimatedLossCost.plus(cost));
    current.lossCount += 1;
    const reason = record.reason.trim() || "未填写原因";
    const reasonStat = current.reasons.get(reason) ?? { count: 0, quantity: 0 };
    reasonStat.count += 1;
    reasonStat.quantity += record.lossQuantity;
    current.reasons.set(reason, reasonStat);
    groups.set(record.flowerWikiId, current);
    totalLossQuantity += record.lossQuantity;
    totalEstimatedLossCost = money(totalEstimatedLossCost.plus(cost));
  }

  const items = [...groups.values()]
    .map((item) => ({
      flowerWikiId: item.flowerWikiId,
      flowerName: item.flowerName,
      lossQuantity: item.lossQuantity,
      estimatedLossCost: moneyString(item.estimatedLossCost),
      lossCount: item.lossCount,
      topReasons: [...item.reasons.entries()]
        .map(([reason, stat]) => ({ reason, ...stat }))
        .sort((a, b) => b.quantity - a.quantity || b.count - a.count)
        .slice(0, 3),
    }))
    .sort((a, b) => money(b.estimatedLossCost).comparedTo(money(a.estimatedLossCost)));

  return {
    dateRange: serializeRange(range),
    items,
    totalLossQuantity,
    totalEstimatedLossCost: moneyString(totalEstimatedLossCost),
  };
}

export async function getInventoryAlertReport(): Promise<InventoryAlertReport> {
  const materials = await prisma.material.findMany({
    select: {
      id: true,
      name: true,
      safetyStockThreshold: true,
      wikiId: true,
      wiki: { select: { chineseName: true } },
      batches: {
        where: { remainingQty: { gt: 0 } },
        select: {
          remainingQty: true,
          unitCost: true,
          inboundAt: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const items = materials.map((material) => {
    const remainingQty = material.batches.reduce((sum, batch) => sum + batch.remainingQty, 0);
    const inventoryValue = material.batches.reduce(
      (sum, batch) => money(sum.plus(money(batch.unitCost).times(batch.remainingQty))),
      money(0)
    );
    const inboundTimes = material.batches.map((batch) => batch.inboundAt.getTime());
    const threshold =
      material.safetyStockThreshold > 0
        ? material.safetyStockThreshold
        : DEFAULT_LOW_STOCK_THRESHOLD;
    const alertLevel: "OUT_OF_STOCK" | "LOW" | "NORMAL" =
      remainingQty === 0 ? "OUT_OF_STOCK" : remainingQty <= threshold ? "LOW" : "NORMAL";
    const reason =
      alertLevel === "OUT_OF_STOCK"
        ? "当前无可用物理批次"
        : alertLevel === "LOW"
          ? `当前库存 ${remainingQty} 支，低于或等于预警阈值 ${threshold} 支`
          : `当前库存 ${remainingQty} 支，高于预警阈值 ${threshold} 支`;

    return {
      flowerWikiId: material.wikiId ?? material.id,
      flowerName: material.wiki?.chineseName ?? material.name,
      remainingQty,
      inventoryValue: moneyString(inventoryValue),
      activeBatchCount: material.batches.length,
      oldestInboundAt:
        inboundTimes.length > 0 ? new Date(Math.min(...inboundTimes)).toISOString() : null,
      latestInboundAt:
        inboundTimes.length > 0 ? new Date(Math.max(...inboundTimes)).toISOString() : null,
      alertLevel,
      reason,
    };
  });

  const alertOrder = { OUT_OF_STOCK: 0, LOW: 1, NORMAL: 2 };
  items.sort(
    (a, b) =>
      alertOrder[a.alertLevel] - alertOrder[b.alertLevel] ||
      a.remainingQty - b.remainingQty ||
      a.flowerName.localeCompare(b.flowerName, "zh-CN")
  );

  return {
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    items,
  };
}

export async function getLossModelImpactReport(
  params: BusinessReportParams = {}
): Promise<LossModelImpactReport> {
  const range = getReportDateRange(params);
  const limit = safeLimit(params.limit, 10);
  const [summary, logs] = await Promise.all([
    getSalesSummaryReport(params),
    prisma.stockLog.findMany({
      where: {
        type: StockLogType.SALE_OUT,
        createdAt: { gte: range.startDate, lt: range.endDate },
      },
      select: {
        quantity: true,
        batch: {
          select: {
            unitCost: true,
            lossAdjustedUnitCost: true,
            usableRate: true,
          },
        },
        material: {
          select: {
            id: true,
            name: true,
            wikiId: true,
            wiki: { select: { chineseName: true } },
          },
        },
      },
    }),
  ]);

  const rows = logs.map((log) => {
    const quantity = log.quantity;
    const rawUnit = money(log.batch.unitCost);
    const adjustedUnit = log.batch.lossAdjustedUnitCost
      ? money(log.batch.lossAdjustedUnitCost)
      : rawUnit;
    const rawCost = money(rawUnit.times(quantity));
    const lossAdjustedCost = money(adjustedUnit.times(quantity));
    return {
      flowerWikiId: log.material.wikiId ?? log.material.id,
      flowerName: log.material.wiki?.chineseName ?? log.material.name,
      quantityUsed: quantity,
      rawCost,
      lossAdjustedCost,
      lossModelExtraCost: money(lossAdjustedCost.minus(rawCost)),
      usableRateSum: log.batch.usableRate ?? 0,
      usableRateCount: log.batch.usableRate ? 1 : 0,
    };
  });

  const aggregate = aggregateLossModelImpact(
    rows,
    summary.totalPaidAmount,
    limit
  );

  return {
    dateRange: serializeRange(range),
    rawFlowerMaterialCost: moneyString(aggregate.rawFlowerMaterialCost),
    lossAdjustedFlowerMaterialCost: moneyString(
      aggregate.lossAdjustedFlowerMaterialCost
    ),
    lossModelExtraCost: moneyString(aggregate.lossModelExtraCost),
    lossModelExtraCostRatioToSales: ratioString(
      aggregate.lossModelExtraCostRatioToSales
    ),
    topMaterialsByLossImpact: aggregate.topMaterialsByLossImpact,
    warnings: aggregate.warnings,
  };
}

export async function getBusinessDashboardReport(
  params: BusinessReportParams = {}
): Promise<BusinessDashboardReport> {
  const [
    summary,
    dailySalesTrend,
    productProfitRanking,
    lowMarginOrders,
    costStructure,
    materialUsage,
    wastage,
    inventoryAlerts,
    lossModelImpact,
  ] = await Promise.all([
    getSalesSummaryReport(params),
    getDailySalesTrend(params),
    getProductProfitRanking({ ...params, limit: params.limit ?? DEFAULT_RANKING_LIMIT }),
    getLowMarginOrders({ ...params, limit: params.limit ?? DEFAULT_RANKING_LIMIT }),
    getCostStructureReport(params),
    getMaterialUsageCostReport(params),
    getWastageReport(params),
    getInventoryAlertReport(),
    getLossModelImpactReport({ ...params, limit: 10 }),
  ]);

  return {
    summary,
    dailySalesTrend,
    productProfitRanking,
    lowMarginOrders,
    costStructure,
    materialUsage,
    wastage,
    inventoryAlerts,
    lossModelImpact,
    warnings: [
      ...summary.warnings,
      ...dailySalesTrend.warnings,
      ...productProfitRanking.warnings,
      ...lossModelImpact.warnings,
    ],
  };
}

export async function backfillMissingOrderCostSnapshots(
  params: BusinessReportParams = {}
): Promise<{
  dateRange: DateRangeDto;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failedOrders: Array<{ orderId: string; orderNo: string; error: string }>;
}> {
  const range = getReportDateRange(params);
  const orders = await prisma.order.findMany({
    where: {
      ...effectiveOrderWhere(range.startDate, range.endDate),
      costSnapshot: null,
    },
    select: { id: true, orderNo: true },
  });

  let successCount = 0;
  const failedOrders: Array<{ orderId: string; orderNo: string; error: string }> = [];
  for (const order of orders) {
    try {
      await upsertOrderCostSnapshot(order.id);
      successCount += 1;
    } catch (error) {
      failedOrders.push({
        orderId: order.id,
        orderNo: order.orderNo,
        error: error instanceof Error ? error.message : "补算失败",
      });
    }
  }

  return {
    dateRange: serializeRange(range),
    successCount,
    failedCount: failedOrders.length,
    skippedCount: 0,
    failedOrders,
  };
}
