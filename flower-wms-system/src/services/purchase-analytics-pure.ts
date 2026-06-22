import { Prisma } from "@/generated/prisma/client";
import { StockLogType } from "@/generated/prisma/enums";
import { money, unitCost, type DecimalInput } from "@/services/purchase-pure";
import { ratio, type DecimalInput as RatioInput } from "@/services/order-cost-pure";

export const PURCHASE_TAG_THRESHOLDS = {
  PRICE_CHANGE_RATE: 0.1,
  HIGH_LOSS_IMPACT_RATE: 0.15,
  STABLE_SUPPLIER_LOSS_RATE: 0.1,
  STABLE_SUPPLIER_MIN_ORDERS: 3,
  OBSERVE_MAX_ORDERS: 1,
  GOOD_CONVERSION_RATE: 0.8,
  GOOD_CONVERSION_MAX_WASTAGE: 0.05,
  PRIORITIZE_USE_REMAINING_RATE: 0.5,
  PRIORITIZE_USE_MIN_DAYS: 3,
  HIGH_WASTAGE_RATE: 0.1,
  SLOW_MOVING_RATE: 0.3,
  SLOW_MOVING_MIN_DAYS: 5,
  INSUFFICIENT_DATA_MIN_PURCHASES: 2,
} as const;

export type PurchaseRecommendationTag =
  | "RECOMMEND_MORE"
  | "CAUTIOUS_PURCHASE"
  | "PRIORITIZE_USE"
  | "PRICE_UP"
  | "PRICE_DOWN"
  | "LOW_RISK"
  | "HIGH_LOSS_IMPACT"
  | "SLOW_MOVING"
  | "GOOD_CONVERSION"
  | "INSUFFICIENT_DATA"
  | "STABLE_SUPPLIER"
  | "OBSERVE";

export const PURCHASE_TAG_LABELS: Record<PurchaseRecommendationTag, string> = {
  RECOMMEND_MORE: "建议多买",
  CAUTIOUS_PURCHASE: "谨慎采购",
  PRIORITIZE_USE: "优先消耗",
  PRICE_UP: "价格上涨",
  PRICE_DOWN: "价格下降",
  LOW_RISK: "低风险",
  HIGH_LOSS_IMPACT: "损耗影响高",
  SLOW_MOVING: "周转慢",
  GOOD_CONVERSION: "转化好",
  INSUFFICIENT_DATA: "数据不足",
  STABLE_SUPPLIER: "稳定供应商",
  OBSERVE: "观察中",
};

export type PurchaseAnalyticsDateRange = {
  startDate: Date;
  endDate: Date;
};

export type PurchaseOrderAnalyticsRow = {
  id: string;
  purchaseNo: string;
  supplierId: string;
  status: string;
  purchaseDate: Date;
  receivedAt: Date | null;
  createdAt: Date;
  goodsAmount: DecimalInput;
  totalExtraFee: DecimalInput;
  totalAmount: DecimalInput;
  supplier: {
    id: string;
    name: string;
    supplierType: string;
  };
};

export type PurchaseLineAnalyticsRow = {
  id: string;
  purchaseOrderId: string;
  flowerWikiId: string | null;
  purchaseQuantity: DecimalInput;
  stemsPerUnit: DecimalInput;
  totalStems: DecimalInput;
  unitPrice: DecimalInput;
  lineAmount: DecimalInput;
  allocatedExtraFee: DecimalInput;
  actualTotalCost: DecimalInput;
  actualUnitCost: DecimalInput;
  usableRate: DecimalInput | null;
  lossRate: DecimalInput | null;
  lossAdjustedTotalCost: DecimalInput | null;
  lossAdjustedUnitCost: DecimalInput | null;
  inboundBatchId: string | null;
  flowerWiki: {
    id: string;
    chineseName: string;
  } | null;
  purchaseOrder: PurchaseOrderAnalyticsRow;
};

export type BatchAnalyticsRow = {
  id: string;
  batchNo: string | null;
  materialId: string;
  originalQty: number;
  remainingQty: number;
  unitCost: DecimalInput;
  lossAdjustedUnitCost: DecimalInput | null;
  usableRate: DecimalInput | null;
  lossRate: DecimalInput | null;
  supplier: string | null;
  inboundAt: Date;
  createdAt: Date;
  flowerWikiId: string | null;
  flowerName: string;
};

export type StockLogAnalyticsRow = {
  id: string;
  materialId: string;
  batchId: string;
  orderId: string | null;
  orderItemId: string | null;
  type: StockLogType | string;
  quantity: number;
  delta: number;
  createdAt: Date;
};

export type PurchaseAnalyticsSummary = {
  purchaseAmount: Prisma.Decimal;
  purchaseOrderCount: number;
  receivedPurchaseOrderCount: number;
  supplierCount: number;
  batchCount: number;
  totalInboundStems: Prisma.Decimal;
  averagePurchaseOrderAmount: Prisma.Decimal;
  rawPurchaseCost: Prisma.Decimal;
  lossAdjustedPurchaseCost: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
  averageActualUnitCost: Prisma.Decimal | null;
  averageLossAdjustedUnitCost: Prisma.Decimal | null;
  pendingPurchaseAmount?: Prisma.Decimal;
  pendingPurchaseOrderCount?: number;
  warnings: string[];
};

export type SupplierPurchaseRankingRow = {
  supplierId: string;
  supplierName: string;
  supplierType: string;
  purchaseAmount: Prisma.Decimal;
  purchaseOrderCount: number;
  lineCount: number;
  inboundStems: Prisma.Decimal;
  rawPurchaseCost: Prisma.Decimal;
  lossAdjustedPurchaseCost: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
  averageActualUnitCost: Prisma.Decimal | null;
  averageLossAdjustedUnitCost: Prisma.Decimal | null;
  lossImpactRate: number | null;
  latestPurchaseDate: Date | null;
  tags: PurchaseRecommendationTag[];
  warnings: string[];
};

export type FlowerPurchasePriceTrendRow = {
  flowerWikiId: string;
  flowerName: string;
  latestPurchaseDate: Date | null;
  latestSupplierName: string | null;
  latestActualUnitCost: Prisma.Decimal | null;
  previousActualUnitCost: Prisma.Decimal | null;
  actualUnitCostChange: Prisma.Decimal | null;
  actualUnitCostChangeRate: number | null;
  latestLossAdjustedUnitCost: Prisma.Decimal | null;
  previousLossAdjustedUnitCost: Prisma.Decimal | null;
  lossAdjustedUnitCostChange: Prisma.Decimal | null;
  lossAdjustedUnitCostChangeRate: number | null;
  purchaseCount: number;
  totalStems: Prisma.Decimal;
  lossImpactRate: number | null;
  tags: PurchaseRecommendationTag[];
  warnings: string[];
};

export type BatchSalesConversionRow = {
  batchId: string;
  batchNo: string | null;
  materialId: string;
  flowerWikiId: string | null;
  flowerName: string;
  supplierName: string | null;
  inboundDate: Date;
  originalQty: number;
  remainingQty: number;
  soldQty: number;
  wastageQty: number;
  cancelReturnQty: number;
  adjustmentQty: number;
  salesConversionRate: number | null;
  actualWastageRate: number | null;
  remainingRate: number | null;
  rawCost: Prisma.Decimal;
  lossAdjustedCost: Prisma.Decimal;
  tags: PurchaseRecommendationTag[];
  warnings: string[];
};

export type BatchCostContributionRow = {
  batchId: string;
  batchNo: string | null;
  flowerWikiId: string | null;
  flowerName: string;
  supplierName: string | null;
  soldQty: number;
  orderCount: number;
  rawCostContribution: Prisma.Decimal;
  lossAdjustedCostContribution: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
  averageRawUnitCost: Prisma.Decimal | null;
  averageLossAdjustedUnitCost: Prisma.Decimal | null;
  tags: PurchaseRecommendationTag[];
  warnings: string[];
};

export type PurchaseRecommendationTagsResult = {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    tags: PurchaseRecommendationTag[];
  }>;
  flowers: Array<{
    flowerWikiId: string;
    flowerName: string;
    tags: PurchaseRecommendationTag[];
  }>;
  batches: Array<{
    batchId: string;
    batchNo: string | null;
    flowerName: string;
    tags: PurchaseRecommendationTag[];
  }>;
};

function resolveLineLossAdjustedTotalCost(line: PurchaseLineAnalyticsRow): Prisma.Decimal {
  if (line.lossAdjustedTotalCost !== null && line.lossAdjustedTotalCost !== undefined) {
    return money(line.lossAdjustedTotalCost);
  }
  return money(line.actualTotalCost);
}

function resolveLineLossAdjustedUnitCost(line: PurchaseLineAnalyticsRow): Prisma.Decimal {
  if (line.lossAdjustedUnitCost !== null && line.lossAdjustedUnitCost !== undefined) {
    return unitCost(line.lossAdjustedUnitCost);
  }
  return unitCost(line.actualUnitCost);
}

export function resolveBatchLossAdjustedUnitCost(batch: BatchAnalyticsRow): Prisma.Decimal {
  if (batch.lossAdjustedUnitCost !== null && batch.lossAdjustedUnitCost !== undefined) {
    return unitCost(batch.lossAdjustedUnitCost);
  }
  return unitCost(batch.unitCost);
}

export function getEffectivePurchaseDate(order: PurchaseOrderAnalyticsRow): Date {
  return order.receivedAt ?? order.purchaseDate ?? order.createdAt;
}

function safeRatio(numerator: Prisma.Decimal, denominator: Prisma.Decimal | number): number | null {
  const denom = typeof denominator === "number" ? new Prisma.Decimal(denominator) : denominator;
  if (denom.isZero()) return null;
  return ratio(numerator.div(denom)).toNumber();
}

function safeUnitCost(total: Prisma.Decimal, stems: Prisma.Decimal): Prisma.Decimal | null {
  if (stems.isZero()) return null;
  return unitCost(total.div(stems));
}

function daysSince(date: Date, now: Date): number {
  const ms = now.getTime() - date.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function uniqueTags(tags: PurchaseRecommendationTag[]): PurchaseRecommendationTag[] {
  return [...new Set(tags)];
}

export function generatePurchaseRecommendationTags(input: {
  entity: "supplier" | "flower" | "batch";
  purchaseOrderCount?: number;
  purchaseCount?: number;
  lossImpactRate?: number | null;
  actualUnitCostChangeRate?: number | null;
  lossAdjustedUnitCostChangeRate?: number | null;
  salesConversionRate?: number | null;
  actualWastageRate?: number | null;
  remainingRate?: number | null;
  inboundDate?: Date | null;
  now?: Date;
}): PurchaseRecommendationTag[] {
  const tags: PurchaseRecommendationTag[] = [];
  const now = input.now ?? new Date();
  const {
    PRICE_CHANGE_RATE,
    HIGH_LOSS_IMPACT_RATE,
    STABLE_SUPPLIER_LOSS_RATE,
    STABLE_SUPPLIER_MIN_ORDERS,
    OBSERVE_MAX_ORDERS,
    GOOD_CONVERSION_RATE,
    GOOD_CONVERSION_MAX_WASTAGE,
    PRIORITIZE_USE_REMAINING_RATE,
    PRIORITIZE_USE_MIN_DAYS,
    HIGH_WASTAGE_RATE,
    SLOW_MOVING_RATE,
    SLOW_MOVING_MIN_DAYS,
    INSUFFICIENT_DATA_MIN_PURCHASES,
  } = PURCHASE_TAG_THRESHOLDS;

  if (input.entity === "supplier") {
    const orderCount = input.purchaseOrderCount ?? 0;
    const lossImpact = input.lossImpactRate;

    if (orderCount <= OBSERVE_MAX_ORDERS) {
      tags.push("OBSERVE");
    }
    if (lossImpact !== null && lossImpact !== undefined) {
      if (lossImpact >= HIGH_LOSS_IMPACT_RATE) {
        tags.push("CAUTIOUS_PURCHASE");
      }
      if (orderCount >= STABLE_SUPPLIER_MIN_ORDERS && lossImpact <= STABLE_SUPPLIER_LOSS_RATE) {
        tags.push("STABLE_SUPPLIER");
      }
    }
    return uniqueTags(tags);
  }

  if (input.entity === "flower") {
    const purchaseCount = input.purchaseCount ?? 0;
    const changeRate = input.actualUnitCostChangeRate ?? input.lossAdjustedUnitCostChangeRate;

    if (purchaseCount < INSUFFICIENT_DATA_MIN_PURCHASES) {
      tags.push("INSUFFICIENT_DATA");
    }
    if (changeRate !== null && changeRate !== undefined) {
      if (changeRate > PRICE_CHANGE_RATE) tags.push("PRICE_UP");
      if (changeRate < -PRICE_CHANGE_RATE) tags.push("PRICE_DOWN");
    }
    if (
      input.lossImpactRate !== null &&
      input.lossImpactRate !== undefined &&
      input.lossImpactRate > HIGH_LOSS_IMPACT_RATE
    ) {
      tags.push("HIGH_LOSS_IMPACT");
    }
    return uniqueTags(tags);
  }

  const inboundDays =
    input.inboundDate !== null && input.inboundDate !== undefined
      ? daysSince(input.inboundDate, now)
      : null;

  if (
    input.salesConversionRate !== null &&
    input.salesConversionRate !== undefined &&
    input.actualWastageRate !== null &&
    input.actualWastageRate !== undefined &&
    input.salesConversionRate >= GOOD_CONVERSION_RATE &&
    input.actualWastageRate <= GOOD_CONVERSION_MAX_WASTAGE
  ) {
    tags.push("GOOD_CONVERSION");
  }

  if (
    input.remainingRate !== null &&
    input.remainingRate !== undefined &&
    inboundDays !== null &&
    input.remainingRate >= PRIORITIZE_USE_REMAINING_RATE &&
    inboundDays >= PRIORITIZE_USE_MIN_DAYS
  ) {
    tags.push("PRIORITIZE_USE");
  }

  if (
    input.actualWastageRate !== null &&
    input.actualWastageRate !== undefined &&
    input.actualWastageRate >= HIGH_WASTAGE_RATE
  ) {
    tags.push("HIGH_LOSS_IMPACT");
  }

  if (
    input.salesConversionRate !== null &&
    input.salesConversionRate !== undefined &&
    inboundDays !== null &&
    input.salesConversionRate <= SLOW_MOVING_RATE &&
    inboundDays >= SLOW_MOVING_MIN_DAYS
  ) {
    tags.push("SLOW_MOVING");
  }

  return uniqueTags(tags);
}

export function calculatePurchaseAnalyticsSummary(input: {
  receivedPurchaseOrders: PurchaseOrderAnalyticsRow[];
  purchaseLines: PurchaseLineAnalyticsRow[];
  batches: BatchAnalyticsRow[];
  dateRange: PurchaseAnalyticsDateRange;
  pendingPurchaseOrders?: PurchaseOrderAnalyticsRow[];
}): PurchaseAnalyticsSummary {
  const warnings: string[] = [];
  const orderIds = new Set(input.receivedPurchaseOrders.map((row) => row.id));
  const supplierIds = new Set(input.receivedPurchaseOrders.map((row) => row.supplierId));
  const relevantLines = input.purchaseLines.filter((line) =>
    orderIds.has(line.purchaseOrderId)
  );

  let purchaseAmount = money(0);
  let rawPurchaseCost = money(0);
  let lossAdjustedPurchaseCost = money(0);
  let totalInboundStems = new Prisma.Decimal(0);
  let missingReceivedAtCount = 0;

  for (const order of input.receivedPurchaseOrders) {
    purchaseAmount = purchaseAmount.plus(money(order.totalAmount));
    if (!order.receivedAt) {
      missingReceivedAtCount += 1;
    }
  }

  for (const line of relevantLines) {
    rawPurchaseCost = rawPurchaseCost.plus(money(line.actualTotalCost));
    lossAdjustedPurchaseCost = lossAdjustedPurchaseCost.plus(
      resolveLineLossAdjustedTotalCost(line)
    );
    totalInboundStems = totalInboundStems.plus(new Prisma.Decimal(line.totalStems ?? 0));
  }

  if (missingReceivedAtCount > 0) {
    warnings.push(
      `有 ${missingReceivedAtCount} 张已入库采购单缺少到货时间，已按采购日期或创建时间纳入统计`
    );
  }

  const lossModelExtraCost = lossAdjustedPurchaseCost.minus(rawPurchaseCost);
  const purchaseOrderCount = input.receivedPurchaseOrders.length;
  const averagePurchaseOrderAmount =
    purchaseOrderCount > 0
      ? money(purchaseAmount.div(purchaseOrderCount))
      : money(0);

  const summary: PurchaseAnalyticsSummary = {
    purchaseAmount,
    purchaseOrderCount,
    receivedPurchaseOrderCount: purchaseOrderCount,
    supplierCount: supplierIds.size,
    batchCount: input.batches.length,
    totalInboundStems,
    averagePurchaseOrderAmount,
    rawPurchaseCost,
    lossAdjustedPurchaseCost,
    lossModelExtraCost,
    averageActualUnitCost: safeUnitCost(rawPurchaseCost, totalInboundStems),
    averageLossAdjustedUnitCost: safeUnitCost(lossAdjustedPurchaseCost, totalInboundStems),
    warnings,
  };

  if (input.pendingPurchaseOrders && input.pendingPurchaseOrders.length > 0) {
    let pendingPurchaseAmount = money(0);
    for (const order of input.pendingPurchaseOrders) {
      pendingPurchaseAmount = pendingPurchaseAmount.plus(money(order.totalAmount));
    }
    summary.pendingPurchaseAmount = pendingPurchaseAmount;
    summary.pendingPurchaseOrderCount = input.pendingPurchaseOrders.length;
    summary.warnings.push(
      `另有 ${input.pendingPurchaseOrders.length} 张未入库采购单，金额 ${pendingPurchaseAmount.toFixed(2)} 元，未计入已入库成本分析`
    );
  }

  if (totalInboundStems.isZero() && relevantLines.length > 0) {
    summary.warnings.push("所选期间采购明细入库支数为 0，平均单支成本无法计算");
  }

  return summary;
}

export function calculateSupplierPurchaseRanking(input: {
  receivedPurchaseOrders: PurchaseOrderAnalyticsRow[];
  purchaseLines: PurchaseLineAnalyticsRow[];
  limit?: number;
}): SupplierPurchaseRankingRow[] {
  const limit = input.limit ?? 20;
  const orderMap = new Map(input.receivedPurchaseOrders.map((row) => [row.id, row]));
  const groups = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      supplierType: string;
      purchaseAmount: Prisma.Decimal;
      purchaseOrderIds: Set<string>;
      lineCount: number;
      inboundStems: Prisma.Decimal;
      rawPurchaseCost: Prisma.Decimal;
      lossAdjustedPurchaseCost: Prisma.Decimal;
      latestPurchaseDate: Date | null;
    }
  >();

  for (const line of input.purchaseLines) {
    const order = orderMap.get(line.purchaseOrderId);
    if (!order) continue;

    const current =
      groups.get(order.supplierId) ??
      {
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        supplierType: order.supplier.supplierType,
        purchaseAmount: money(0),
        purchaseOrderIds: new Set<string>(),
        lineCount: 0,
        inboundStems: new Prisma.Decimal(0),
        rawPurchaseCost: money(0),
        lossAdjustedPurchaseCost: money(0),
        latestPurchaseDate: null,
      };

    current.purchaseOrderIds.add(order.id);
    current.lineCount += 1;
    current.inboundStems = current.inboundStems.plus(new Prisma.Decimal(line.totalStems ?? 0));
    current.rawPurchaseCost = current.rawPurchaseCost.plus(money(line.actualTotalCost));
    current.lossAdjustedPurchaseCost = current.lossAdjustedPurchaseCost.plus(
      resolveLineLossAdjustedTotalCost(line)
    );

    const purchaseDate = getEffectivePurchaseDate(order);
    if (!current.latestPurchaseDate || purchaseDate > current.latestPurchaseDate) {
      current.latestPurchaseDate = purchaseDate;
    }

    groups.set(order.supplierId, current);
  }

  for (const order of input.receivedPurchaseOrders) {
    const current = groups.get(order.supplierId);
    if (!current) continue;
    current.purchaseAmount = current.purchaseAmount.plus(money(order.totalAmount));
    current.purchaseOrderIds.add(order.id);
    groups.set(order.supplierId, current);
  }

  return [...groups.values()]
    .map((item) => {
      const lossModelExtraCost = item.lossAdjustedPurchaseCost.minus(item.rawPurchaseCost);
      const lossImpactRate = safeRatio(lossModelExtraCost, item.rawPurchaseCost);
      const tags = generatePurchaseRecommendationTags({
        entity: "supplier",
        purchaseOrderCount: item.purchaseOrderIds.size,
        lossImpactRate,
      });

      return {
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        supplierType: item.supplierType,
        purchaseAmount: item.purchaseAmount,
        purchaseOrderCount: item.purchaseOrderIds.size,
        lineCount: item.lineCount,
        inboundStems: item.inboundStems,
        rawPurchaseCost: item.rawPurchaseCost,
        lossAdjustedPurchaseCost: item.lossAdjustedPurchaseCost,
        lossModelExtraCost,
        averageActualUnitCost: safeUnitCost(item.rawPurchaseCost, item.inboundStems),
        averageLossAdjustedUnitCost: safeUnitCost(
          item.lossAdjustedPurchaseCost,
          item.inboundStems
        ),
        lossImpactRate,
        latestPurchaseDate: item.latestPurchaseDate,
        tags,
        warnings: [] as string[],
      };
    })
    .sort((a, b) => b.purchaseAmount.comparedTo(a.purchaseAmount))
    .slice(0, limit);
}

export function calculateFlowerPurchasePriceTrends(input: {
  purchaseLines: PurchaseLineAnalyticsRow[];
  limit?: number;
}): FlowerPurchasePriceTrendRow[] {
  const limit = input.limit ?? 20;
  const groups = new Map<
    string,
    Array<{
      purchaseDate: Date;
      supplierName: string;
      actualUnitCost: Prisma.Decimal;
      lossAdjustedUnitCost: Prisma.Decimal;
      totalStems: Prisma.Decimal;
    }>
  >();

  for (const line of input.purchaseLines) {
    if (!line.flowerWikiId) continue;
    const order = line.purchaseOrder;
    const entries =
      groups.get(line.flowerWikiId) ??
      [];
    entries.push({
      purchaseDate: getEffectivePurchaseDate(order),
      supplierName: order.supplier.name,
      actualUnitCost: unitCost(line.actualUnitCost),
      lossAdjustedUnitCost: resolveLineLossAdjustedUnitCost(line),
      totalStems: new Prisma.Decimal(line.totalStems ?? 0),
    });
    groups.set(line.flowerWikiId, entries);
  }

  const rows: FlowerPurchasePriceTrendRow[] = [];

  for (const [flowerWikiId, entries] of groups) {
    const sorted = [...entries].sort(
      (a, b) => b.purchaseDate.getTime() - a.purchaseDate.getTime()
    );
    const latest = sorted[0];
    const previous = sorted[1];
    const flowerName =
      input.purchaseLines.find((line) => line.flowerWikiId === flowerWikiId)?.flowerWiki
        ?.chineseName ?? flowerWikiId;

    const warnings: string[] = [];
    let actualUnitCostChange: Prisma.Decimal | null = null;
    let actualUnitCostChangeRate: number | null = null;
    let lossAdjustedUnitCostChange: Prisma.Decimal | null = null;
    let lossAdjustedUnitCostChangeRate: number | null = null;

    if (previous) {
      actualUnitCostChange = latest.actualUnitCost.minus(previous.actualUnitCost);
      actualUnitCostChangeRate = safeRatio(actualUnitCostChange, previous.actualUnitCost);
      lossAdjustedUnitCostChange = latest.lossAdjustedUnitCost.minus(
        previous.lossAdjustedUnitCost
      );
      lossAdjustedUnitCostChangeRate = safeRatio(
        lossAdjustedUnitCostChange,
        previous.lossAdjustedUnitCost
      );
    } else {
      warnings.push("该花材在统计期间只有一次采购记录，暂无上次价格可对比");
    }

    if (
      previous &&
      previous.actualUnitCost.isZero() &&
      actualUnitCostChangeRate === null
    ) {
      warnings.push("上次采购实际单支成本为 0，无法计算涨幅比例");
    }

    const totalStems = sorted.reduce(
      (sum, entry) => sum.plus(entry.totalStems),
      new Prisma.Decimal(0)
    );
    const rawPurchaseCost = sorted.reduce(
      (sum, entry) => sum.plus(entry.actualUnitCost.times(entry.totalStems)),
      money(0)
    );
    const lossAdjustedPurchaseCost = sorted.reduce(
      (sum, entry) => sum.plus(entry.lossAdjustedUnitCost.times(entry.totalStems)),
      money(0)
    );
    const lossImpactRate = safeRatio(
      lossAdjustedPurchaseCost.minus(rawPurchaseCost),
      rawPurchaseCost
    );

    const tags = generatePurchaseRecommendationTags({
      entity: "flower",
      purchaseCount: sorted.length,
      lossImpactRate,
      actualUnitCostChangeRate,
      lossAdjustedUnitCostChangeRate,
    });

    rows.push({
      flowerWikiId,
      flowerName,
      latestPurchaseDate: latest.purchaseDate,
      latestSupplierName: latest.supplierName,
      latestActualUnitCost: latest.actualUnitCost,
      previousActualUnitCost: previous?.actualUnitCost ?? null,
      actualUnitCostChange,
      actualUnitCostChangeRate,
      latestLossAdjustedUnitCost: latest.lossAdjustedUnitCost,
      previousLossAdjustedUnitCost: previous?.lossAdjustedUnitCost ?? null,
      lossAdjustedUnitCostChange,
      lossAdjustedUnitCostChangeRate,
      purchaseCount: sorted.length,
      totalStems,
      lossImpactRate,
      tags,
      warnings,
    });
  }

  return rows
    .sort((a, b) => {
      const aRate = Math.abs(a.actualUnitCostChangeRate ?? 0);
      const bRate = Math.abs(b.actualUnitCostChangeRate ?? 0);
      if (bRate !== aRate) return bRate - aRate;
      const aDate = a.latestPurchaseDate?.getTime() ?? 0;
      const bDate = b.latestPurchaseDate?.getTime() ?? 0;
      return bDate - aDate;
    })
    .slice(0, limit);
}

function sumLogQuantity(
  logs: StockLogAnalyticsRow[],
  batchId: string,
  type: StockLogType
): number {
  return logs
    .filter((log) => log.batchId === batchId && log.type === type)
    .reduce((sum, log) => sum + log.quantity, 0);
}

export function calculateBatchSalesConversion(input: {
  batches: BatchAnalyticsRow[];
  stockLogs: StockLogAnalyticsRow[];
  now?: Date;
}): BatchSalesConversionRow[] {
  const now = input.now ?? new Date();

  return input.batches
    .map((batch) => {
      const soldQty = sumLogQuantity(input.stockLogs, batch.id, StockLogType.SALE_OUT);
      const wastageQty = sumLogQuantity(input.stockLogs, batch.id, StockLogType.WASTAGE_OUT);
      const cancelReturnQty = sumLogQuantity(input.stockLogs, batch.id, StockLogType.IN_CANCEL);
      const adjustmentQty = input.stockLogs
        .filter(
          (log) => log.batchId === batch.id && log.type === StockLogType.ADJUSTMENT
        )
        .reduce((sum, log) => sum + Math.abs(log.delta), 0);

      const originalQty = batch.originalQty;
      const salesConversionRate =
        originalQty > 0 ? ratio(soldQty).div(originalQty).toNumber() : null;
      const actualWastageRate =
        originalQty > 0 ? ratio(wastageQty).div(originalQty).toNumber() : null;
      const remainingRate =
        originalQty > 0 ? ratio(batch.remainingQty).div(originalQty).toNumber() : null;

      const lossAdjustedUnitCost = resolveBatchLossAdjustedUnitCost(batch);
      const rawCost = money(unitCost(batch.unitCost).times(soldQty));
      const lossAdjustedCost = money(lossAdjustedUnitCost.times(soldQty));

      const tags = generatePurchaseRecommendationTags({
        entity: "batch",
        salesConversionRate,
        actualWastageRate,
        remainingRate,
        inboundDate: batch.inboundAt,
        now,
      });

      const warnings: string[] = [];
      if (originalQty === 0) {
        warnings.push("该批次原始入库数量为 0，无法计算转化率和报损率");
      }

      return {
        batchId: batch.id,
        batchNo: batch.batchNo,
        materialId: batch.materialId,
        flowerWikiId: batch.flowerWikiId,
        flowerName: batch.flowerName,
        supplierName: batch.supplier,
        inboundDate: batch.inboundAt,
        originalQty,
        remainingQty: batch.remainingQty,
        soldQty,
        wastageQty,
        cancelReturnQty,
        adjustmentQty,
        salesConversionRate,
        actualWastageRate,
        remainingRate,
        rawCost,
        lossAdjustedCost,
        tags,
        warnings,
      };
    })
    .sort((a, b) => b.inboundDate.getTime() - a.inboundDate.getTime());
}

export function calculateBatchCostContribution(input: {
  batches: BatchAnalyticsRow[];
  stockLogs: StockLogAnalyticsRow[];
}): BatchCostContributionRow[] {
  const batchMap = new Map(input.batches.map((batch) => [batch.id, batch]));

  const groups = new Map<
    string,
    {
      batch: BatchAnalyticsRow;
      soldQty: number;
      orderIds: Set<string>;
    }
  >();

  for (const log of input.stockLogs) {
    if (log.type !== StockLogType.SALE_OUT) continue;
    const batch = batchMap.get(log.batchId);
    if (!batch) continue;

    const current =
      groups.get(log.batchId) ??
      {
        batch,
        soldQty: 0,
        orderIds: new Set<string>(),
      };
    current.soldQty += log.quantity;
    if (log.orderId) current.orderIds.add(log.orderId);
    groups.set(log.batchId, current);
  }

  return [...groups.values()]
    .map(({ batch, soldQty, orderIds }) => {
      const lossAdjustedUnitCost = resolveBatchLossAdjustedUnitCost(batch);
      const rawCostContribution = money(unitCost(batch.unitCost).times(soldQty));
      const lossAdjustedCostContribution = money(lossAdjustedUnitCost.times(soldQty));
      const lossModelExtraCost = lossAdjustedCostContribution.minus(rawCostContribution);

      const tags = generatePurchaseRecommendationTags({
        entity: "batch",
        salesConversionRate:
          batch.originalQty > 0 ? soldQty / batch.originalQty : null,
        actualWastageRate: null,
        remainingRate:
          batch.originalQty > 0 ? batch.remainingQty / batch.originalQty : null,
        inboundDate: batch.inboundAt,
      });

      const warnings: string[] = [];
      if (
        batch.lossAdjustedUnitCost === null ||
        batch.lossAdjustedUnitCost === undefined
      ) {
        warnings.push("该批次未记录损耗调整后单支成本，已按原始入库成本估算");
      }

      return {
        batchId: batch.id,
        batchNo: batch.batchNo,
        flowerWikiId: batch.flowerWikiId,
        flowerName: batch.flowerName,
        supplierName: batch.supplier,
        soldQty,
        orderCount: orderIds.size,
        rawCostContribution,
        lossAdjustedCostContribution,
        lossModelExtraCost,
        averageRawUnitCost: soldQty > 0 ? unitCost(rawCostContribution.div(soldQty)) : null,
        averageLossAdjustedUnitCost:
          soldQty > 0 ? unitCost(lossAdjustedCostContribution.div(soldQty)) : null,
        tags,
        warnings,
      };
    })
    .sort((a, b) => b.lossModelExtraCost.comparedTo(a.lossModelExtraCost));
}

export function buildPurchaseRecommendationTags(input: {
  supplierRanking: SupplierPurchaseRankingRow[];
  flowerPriceTrends: FlowerPurchasePriceTrendRow[];
  batchSalesConversion: BatchSalesConversionRow[];
}): PurchaseRecommendationTagsResult {
  return {
    suppliers: input.supplierRanking.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      tags: row.tags,
    })),
    flowers: input.flowerPriceTrends.map((row) => ({
      flowerWikiId: row.flowerWikiId,
      flowerName: row.flowerName,
      tags: row.tags,
    })),
    batches: input.batchSalesConversion.map((row) => ({
      batchId: row.batchId,
      batchNo: row.batchNo,
      flowerName: row.flowerName,
      tags: row.tags,
    })),
  };
}

export function ratioToNumber(value: RatioInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  return ratio(value).toNumber();
}
