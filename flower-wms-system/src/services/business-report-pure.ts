import { Prisma } from "@/generated/prisma/client";
import {
  decimalToString,
  money,
  ratio,
  type DecimalInput,
} from "@/services/order-cost-pure";

export type ReportPreset =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "lastMonth";

export type ReportDateRangeParams = {
  preset?: ReportPreset | string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  now?: Date;
};

export type ReportDateRange = {
  startDate: Date;
  endDate: Date;
  label: string;
};

export type SalesSummaryInput = {
  id: string;
  paidAmount: DecimalInput;
  status: string;
  isEffective: boolean;
  isRefunded: boolean;
  hasSnapshot: boolean;
  snapshot?: {
    paidAmount?: DecimalInput;
    flowerMaterialCost?: DecimalInput;
    packagingCost?: DecimalInput;
    deliveryCostActual?: DecimalInput;
    platformFee?: DecimalInput;
    floristLaborCost?: DecimalInput;
    otherCost?: DecimalInput;
    totalCost?: DecimalInput;
  } | null;
};

export type SalesSummaryTotals = {
  totalPaidAmount: Prisma.Decimal;
  orderCount: number;
  paidOrderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  refundedOrderCount: number;
  totalCost: Prisma.Decimal;
  flowerMaterialCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
  deliveryCostActual: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  floristLaborCost: Prisma.Decimal;
  otherCost: Prisma.Decimal;
  grossProfit: Prisma.Decimal;
  grossMargin: Prisma.Decimal;
  averageOrderValue: Prisma.Decimal;
  averageGrossProfitPerOrder: Prisma.Decimal;
  missingSnapshotOrderCount: number;
  missingSnapshotOrderIds: string[];
  warnings: string[];
};

export type CostStructureInput = {
  totalCost: DecimalInput;
  flowerMaterialCost: DecimalInput;
  packagingCost: DecimalInput;
  deliveryCostActual: DecimalInput;
  platformFee: DecimalInput;
  floristLaborCost: DecimalInput;
  otherCost: DecimalInput;
};

export type CostStructureRatios = {
  flowerMaterialCostRatio: Prisma.Decimal;
  packagingCostRatio: Prisma.Decimal;
  deliveryCostRatio: Prisma.Decimal;
  platformFeeRatio: Prisma.Decimal;
  floristLaborCostRatio: Prisma.Decimal;
  otherCostRatio: Prisma.Decimal;
};

export type LowMarginInput = {
  orderId: string;
  grossMargin: DecimalInput;
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) return startOfDay(value);
  const trimmed = value.trim();
  if (!trimmed) return startOfDay(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return startOfDay(new Date(trimmed));
}

function formatDateLabel(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizePreset(preset?: string | null): ReportPreset {
  const allowed = new Set<ReportPreset>([
    "today",
    "yesterday",
    "thisWeek",
    "thisMonth",
    "lastMonth",
  ]);
  return allowed.has(preset as ReportPreset)
    ? (preset as ReportPreset)
    : "thisMonth";
}

export function getReportDateRange(
  params: ReportDateRangeParams = {}
): ReportDateRange {
  const now = params.now ?? new Date();
  const today = startOfDay(now);

  if (params.startDate || params.endDate) {
    const startDate = params.startDate ? parseDateOnly(params.startDate) : today;
    const inclusiveEnd = params.endDate
      ? parseDateOnly(params.endDate)
      : startDate;
    const endDate = addDays(inclusiveEnd, 1);
    return {
      startDate,
      endDate,
      label: `${formatDateLabel(startDate)} 至 ${formatDateLabel(inclusiveEnd)}`,
    };
  }

  const preset = normalizePreset(params.preset);
  if (preset === "today") {
    return {
      startDate: today,
      endDate: addDays(today, 1),
      label: "今日",
    };
  }
  if (preset === "yesterday") {
    const startDate = addDays(today, -1);
    return {
      startDate,
      endDate: today,
      label: "昨日",
    };
  }
  if (preset === "thisWeek") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startDate = addDays(today, mondayOffset);
    return {
      startDate,
      endDate: addDays(today, 1),
      label: "本周",
    };
  }
  if (preset === "lastMonth") {
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      startDate,
      endDate,
      label: "上月",
    };
  }

  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    startDate,
    endDate: addDays(today, 1),
    label: "本月",
  };
}

export function sumSalesSummaryRows(
  rows: SalesSummaryInput[]
): SalesSummaryTotals {
  let totalPaidAmount = money(0);
  let totalCost = money(0);
  let flowerMaterialCost = money(0);
  let packagingCost = money(0);
  let deliveryCostActual = money(0);
  let platformFee = money(0);
  let floristLaborCost = money(0);
  let otherCost = money(0);
  let paidOrderCount = 0;
  let completedOrderCount = 0;
  let cancelledOrderCount = 0;
  let refundedOrderCount = 0;
  const missingSnapshotOrderIds: string[] = [];

  for (const row of rows) {
    if (row.status === "COMPLETED") completedOrderCount += 1;
    if (row.status === "CANCELLED") cancelledOrderCount += 1;
    if (row.isRefunded) refundedOrderCount += 1;

    if (!row.isEffective) continue;

    paidOrderCount += 1;
    const paidAmount = money(row.snapshot?.paidAmount ?? row.paidAmount);
    totalPaidAmount = money(totalPaidAmount.plus(paidAmount));

    if (!row.hasSnapshot || !row.snapshot) {
      missingSnapshotOrderIds.push(row.id);
      continue;
    }

    const rowFlower = money(row.snapshot.flowerMaterialCost);
    const rowPackaging = money(row.snapshot.packagingCost);
    const rowDelivery = money(row.snapshot.deliveryCostActual);
    const rowPlatform = money(row.snapshot.platformFee);
    const rowLabor = money(row.snapshot.floristLaborCost);
    const rowOther = money(row.snapshot.otherCost);
    const rowTotal = money(
      row.snapshot.totalCost ??
        rowFlower.plus(rowPackaging).plus(rowDelivery).plus(rowPlatform).plus(rowLabor).plus(rowOther)
    );

    flowerMaterialCost = money(flowerMaterialCost.plus(rowFlower));
    packagingCost = money(packagingCost.plus(rowPackaging));
    deliveryCostActual = money(deliveryCostActual.plus(rowDelivery));
    platformFee = money(platformFee.plus(rowPlatform));
    floristLaborCost = money(floristLaborCost.plus(rowLabor));
    otherCost = money(otherCost.plus(rowOther));
    totalCost = money(totalCost.plus(rowTotal));
  }

  const grossProfit = money(totalPaidAmount.minus(totalCost));
  const grossMargin = totalPaidAmount.greaterThan(0)
    ? ratio(grossProfit.div(totalPaidAmount))
    : ratio(0);
  const averageOrderValue =
    paidOrderCount > 0 ? money(totalPaidAmount.div(paidOrderCount)) : money(0);
  const averageGrossProfitPerOrder =
    paidOrderCount > 0 ? money(grossProfit.div(paidOrderCount)) : money(0);
  const warnings =
    missingSnapshotOrderIds.length > 0
      ? [
          `有 ${missingSnapshotOrderIds.length} 个订单缺少成本快照，毛利可能偏高。`,
        ]
      : [];

  return {
    totalPaidAmount,
    orderCount: paidOrderCount,
    paidOrderCount,
    completedOrderCount,
    cancelledOrderCount,
    refundedOrderCount,
    totalCost,
    flowerMaterialCost,
    packagingCost,
    deliveryCostActual,
    platformFee,
    floristLaborCost,
    otherCost,
    grossProfit,
    grossMargin,
    averageOrderValue,
    averageGrossProfitPerOrder,
    missingSnapshotOrderCount: missingSnapshotOrderIds.length,
    missingSnapshotOrderIds: missingSnapshotOrderIds.slice(0, 10),
    warnings,
  };
}

export function calculateCostStructureRatios(
  input: CostStructureInput
): CostStructureRatios {
  const totalCost = money(input.totalCost);
  const divide = (value: DecimalInput) =>
    totalCost.greaterThan(0) ? ratio(money(value).div(totalCost)) : ratio(0);

  return {
    flowerMaterialCostRatio: divide(input.flowerMaterialCost),
    packagingCostRatio: divide(input.packagingCost),
    deliveryCostRatio: divide(input.deliveryCostActual),
    platformFeeRatio: divide(input.platformFee),
    floristLaborCostRatio: divide(input.floristLaborCost),
    otherCostRatio: divide(input.otherCost),
  };
}

export function filterLowMarginRows<T extends LowMarginInput>(
  rows: T[],
  threshold: DecimalInput = "0.35"
): T[] {
  const limit = ratio(threshold);
  return [...rows]
    .filter((row) => ratio(row.grossMargin).lessThan(limit))
    .sort((a, b) => ratio(a.grossMargin).comparedTo(ratio(b.grossMargin)));
}

export function moneyString(value: DecimalInput): string {
  return decimalToString(money(value));
}

export function ratioString(value: DecimalInput): string {
  return decimalToString(ratio(value), 4);
}

export type LossModelImpactMaterialRow = {
  flowerWikiId: string;
  flowerName: string;
  quantityUsed: number;
  rawCost: DecimalInput;
  lossAdjustedCost: DecimalInput;
  lossModelExtraCost: DecimalInput;
  usableRateSum: DecimalInput;
  usableRateCount: number;
};

export type LossModelImpactAggregate = {
  rawFlowerMaterialCost: Prisma.Decimal;
  lossAdjustedFlowerMaterialCost: Prisma.Decimal;
  lossModelExtraCost: Prisma.Decimal;
  lossModelExtraCostRatioToSales: Prisma.Decimal;
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

export function aggregateLossModelImpact(
  rows: LossModelImpactMaterialRow[],
  totalPaidAmount: DecimalInput,
  topLimit = 10
): LossModelImpactAggregate {
  let rawFlowerMaterialCost = money(0);
  let lossAdjustedFlowerMaterialCost = money(0);
  const warnings: string[] = [];

  const grouped = new Map<
    string,
    {
      flowerWikiId: string;
      flowerName: string;
      quantityUsed: number;
      rawCost: Prisma.Decimal;
      lossAdjustedCost: Prisma.Decimal;
      usableRateSum: Prisma.Decimal;
      usableRateCount: number;
    }
  >();

  for (const row of rows) {
    rawFlowerMaterialCost = money(
      rawFlowerMaterialCost.plus(money(row.rawCost))
    );
    lossAdjustedFlowerMaterialCost = money(
      lossAdjustedFlowerMaterialCost.plus(money(row.lossAdjustedCost))
    );

    const current =
      grouped.get(row.flowerWikiId) ??
      {
        flowerWikiId: row.flowerWikiId,
        flowerName: row.flowerName,
        quantityUsed: 0,
        rawCost: money(0),
        lossAdjustedCost: money(0),
        usableRateSum: money(0),
        usableRateCount: 0,
      };
    current.quantityUsed += row.quantityUsed;
    current.rawCost = money(current.rawCost.plus(money(row.rawCost)));
    current.lossAdjustedCost = money(
      current.lossAdjustedCost.plus(money(row.lossAdjustedCost))
    );
    if (row.usableRateCount > 0) {
      current.usableRateSum = money(
        current.usableRateSum.plus(money(row.usableRateSum))
      );
      current.usableRateCount += row.usableRateCount;
    }
    grouped.set(row.flowerWikiId, current);
  }

  const lossModelExtraCost = money(
    lossAdjustedFlowerMaterialCost.minus(rawFlowerMaterialCost)
  );
  const paid = money(totalPaidAmount);
  const lossModelExtraCostRatioToSales = paid.greaterThan(0)
    ? ratio(lossModelExtraCost.div(paid))
    : ratio(0);
  if (!paid.greaterThan(0)) {
    warnings.push("统计期内有效销售额为 0，损耗成本占销售额比例按 0 计算");
  }
  if (rows.length === 0) {
    warnings.push("暂无可分析的销售出库数据");
  }

  const topMaterialsByLossImpact = [...grouped.values()]
    .map((item) => {
      const extra = money(item.lossAdjustedCost.minus(item.rawCost));
      return {
        flowerWikiId: item.flowerWikiId,
        flowerName: item.flowerName,
        quantityUsed: item.quantityUsed,
        rawCost: moneyString(item.rawCost),
        lossAdjustedCost: moneyString(item.lossAdjustedCost),
        lossModelExtraCost: moneyString(extra),
        avgUsableRate:
          item.usableRateCount > 0
            ? ratioString(
                item.usableRateSum.div(item.usableRateCount)
              )
            : null,
        _extra: extra,
      };
    })
    .sort((a, b) => b._extra.comparedTo(a._extra))
    .slice(0, topLimit)
    .map(({ _extra, ...item }) => item);

  return {
    rawFlowerMaterialCost,
    lossAdjustedFlowerMaterialCost,
    lossModelExtraCost,
    lossModelExtraCostRatioToSales,
    topMaterialsByLossImpact,
    warnings,
  };
}
