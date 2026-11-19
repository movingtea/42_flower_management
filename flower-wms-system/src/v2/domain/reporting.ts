/**
 * Pure V2 WMS reporting rules.
 *
 * The module has no Prisma or server-only imports. Services load V2 rows, map
 * them to these plain inputs, and the report page renders the derived numbers.
 * That keeps the money/quantity maths testable without a database and keeps the
 * V2 pages independent from any V1 Prisma model.
 */
import {
  addAppCalendarDays,
  appDateStringFromParts,
  formatDateInAppTimezoneIso,
  getAppCalendarParts,
  getAppDayRangeUtc,
  getTodayAppDateString,
  listAppDateKeysInRange,
  parseAppDateString,
} from "@/lib/datetime";

export const REPORT_TABS = [
  "overview",
  "sales",
  "products",
  "inventory",
  "loss",
  "purchase",
  "cost",
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

export const REPORT_TAB_LABELS: Readonly<Record<ReportTab, string>> = {
  overview: "经营总览",
  sales: "销售趋势",
  products: "商品毛利",
  inventory: "库存预警与效期",
  loss: "损耗与损耗模型",
  purchase: "采购分析",
  cost: "成本快照",
};

export const REPORT_PRESETS = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "lastMonth",
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number];

export const REPORT_PRESET_LABELS: Readonly<Record<ReportPreset, string>> = {
  today: "今日",
  yesterday: "昨日",
  thisWeek: "本周",
  thisMonth: "本月",
  lastMonth: "上月",
};

const MAX_RANGE_DAYS = 366;

export type ReportRange = {
  /** Inclusive app-timezone date key, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive app-timezone date key, YYYY-MM-DD. */
  endDate: string;
  startUtc: Date;
  endUtcExclusive: Date;
  label: string;
  preset: ReportPreset | null;
  /** True when an over-long custom range was clipped to MAX_RANGE_DAYS. */
  clamped: boolean;
};

function normalizePreset(preset: string | null | undefined): ReportPreset {
  return (REPORT_PRESETS as readonly string[]).includes(preset ?? "")
    ? (preset as ReportPreset)
    : "thisMonth";
}

function dateKeyOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return parseAppDateString(trimmed) ? trimmed : null;
}

/**
 * Resolve the one date range shared by every report tab. Invalid dates fall
 * back to "this month" so a stale bookmarked URL cannot break the page.
 */
export function resolveReportRange(input: {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  now?: Date;
} = {}): ReportRange {
  const now = input.now ?? new Date();
  const today = getTodayAppDateString(now);
  const customStart = dateKeyOrNull(input.startDate);
  const customEnd = dateKeyOrNull(input.endDate);

  if (customStart || customEnd) {
    let startDate = customStart ?? customEnd ?? today;
    let endDate = customEnd ?? customStart ?? today;
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
    let clamped = false;
    const endParts = parseAppDateString(endDate)!;
    const startMs = getAppDayRangeUtc(startDate).startUtc.getTime();
    const endMs = getAppDayRangeUtc(endDate).endUtcExclusive.getTime();
    if ((endMs - startMs) / 86_400_000 > MAX_RANGE_DAYS) {
      const clippedStart = addAppCalendarDays(endParts, -(MAX_RANGE_DAYS - 1));
      startDate = appDateStringFromParts(clippedStart);
      clamped = true;
    }
    const startRange = getAppDayRangeUtc(startDate);
    const endRange = getAppDayRangeUtc(endDate);
    return {
      startDate,
      endDate,
      startUtc: startRange.startUtc,
      endUtcExclusive: endRange.endUtcExclusive,
      label: clamped
        ? `${startDate} 至 ${endDate}（超过 366 天，已截断）`
        : `${startDate} 至 ${endDate}`,
      preset: null,
      clamped,
    };
  }

  const preset = normalizePreset(input.preset);
  const todayParts = getAppCalendarParts(now);
  if (preset === "today") {
    const range = getAppDayRangeUtc(today);
    return {
      startDate: today,
      endDate: today,
      startUtc: range.startUtc,
      endUtcExclusive: range.endUtcExclusive,
      label: "今日",
      preset,
      clamped: false,
    };
  }
  if (preset === "yesterday") {
    const key = appDateStringFromParts(addAppCalendarDays(todayParts, -1));
    const range = getAppDayRangeUtc(key);
    return {
      startDate: key,
      endDate: key,
      startUtc: range.startUtc,
      endUtcExclusive: range.endUtcExclusive,
      label: "昨日",
      preset,
      clamped: false,
    };
  }
  if (preset === "thisWeek") {
    const weekdayOffset = todayParts.weekday === 0 ? -6 : 1 - todayParts.weekday;
    const startKey = appDateStringFromParts(addAppCalendarDays(todayParts, weekdayOffset));
    const start = getAppDayRangeUtc(startKey);
    const end = getAppDayRangeUtc(today);
    return {
      startDate: startKey,
      endDate: today,
      startUtc: start.startUtc,
      endUtcExclusive: end.endUtcExclusive,
      label: "本周",
      preset,
      clamped: false,
    };
  }
  if (preset === "lastMonth") {
    const lastMonthStart =
      todayParts.month === 1
        ? { year: todayParts.year - 1, month: 12, day: 1 }
        : { year: todayParts.year, month: todayParts.month - 1, day: 1 };
    const thisMonthStart = { year: todayParts.year, month: todayParts.month, day: 1 };
    const startKey = appDateStringFromParts(lastMonthStart);
    const endKey = appDateStringFromParts(addAppCalendarDays(thisMonthStart, -1));
    const endKeyExclusive = appDateStringFromParts(thisMonthStart);
    const start = getAppDayRangeUtc(startKey);
    const end = getAppDayRangeUtc(endKeyExclusive);
    return {
      startDate: startKey,
      endDate: endKey,
      startUtc: start.startUtc,
      // Last month ends at this month's first midnight.
      endUtcExclusive: end.startUtc,
      label: "上月",
      preset,
      clamped: false,
    };
  }

  const monthStart = appDateStringFromParts({ year: todayParts.year, month: todayParts.month, day: 1 });
  const start = getAppDayRangeUtc(monthStart);
  const end = getAppDayRangeUtc(today);
  return {
    startDate: monthStart,
    endDate: today,
    startUtc: start.startUtc,
    endUtcExclusive: end.endUtcExclusive,
    label: "本月",
    preset: "thisMonth",
    clamped: false,
  };
}

export function reportDateKeys(range: ReportRange): string[] {
  return listAppDateKeysInRange(range.startUtc, range.endUtcExclusive);
}

export function inReportRange(value: Date, range: ReportRange): boolean {
  return value.getTime() >= range.startUtc.getTime()
    && value.getTime() < range.endUtcExclusive.getTime();
}

export function isReportTab(value: unknown): value is ReportTab {
  return typeof value === "string" && (REPORT_TABS as readonly string[]).includes(value);
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

export type CostBreakdown = {
  revenue: number;
  materialCost: number;
  packagingCost: number;
  consumableCost: number;
  laborCost: number;
  deliveryCost: number;
  platformCost: number;
  attributedLossCost: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
};

export type CostAdjustmentInput = {
  kind: string;
  amountDelta: number | string;
};

const ADJUSTMENT_FIELD: Readonly<
  Record<string, Exclude<keyof CostBreakdown, "totalCost" | "grossProfit" | "grossMargin">>
> = {
  MATERIAL: "materialCost",
  PACKAGING: "packagingCost",
  CONSUMABLE: "consumableCost",
  LABOR: "laborCost",
  DELIVERY: "deliveryCost",
  PLATFORM: "platformCost",
  LOSS: "attributedLossCost",
};

export type SnapshotBaseInput = {
  orderId: string;
  orderNumber: string;
  revisionNo: number;
  closedAt: Date;
  estimated: boolean;
  commercialState: string;
  revenue: number | string;
  materialCost: number | string;
  packagingCost: number | string;
  consumableCost: number | string;
  laborCost: number | string;
  deliveryCost: number | string;
  platformCost: number | string;
  attributedLossCost: number | string;
  adjustments: readonly CostAdjustmentInput[];
};

export type SnapshotItemInput = {
  skuId: string | null;
  productName: string;
  skuName: string;
  quantity: number;
  unitPrice: number | string;
};

export type OrderSnapshotRow = CostBreakdown & {
  orderId: string;
  orderNumber: string;
  revisionNo: number;
  closedAt: Date;
  estimated: boolean;
  commercialState: string;
  adjustmentTotal: number;
  adjustmentCount: number;
  items: SnapshotItemInput[];
};

/** Applies signed CostAdjustment rows to a cost snapshot. */
export function applyCostAdjustments(
  base: Omit<CostBreakdown, "totalCost" | "grossProfit" | "grossMargin">,
  adjustments: readonly CostAdjustmentInput[],
): CostBreakdown {
  const next = { ...base };
  for (const adjustment of adjustments) {
    const field = ADJUSTMENT_FIELD[adjustment.kind];
    if (!field || field === "revenue") continue;
    const current = num(next[field]);
    next[field] = round2(current + num(adjustment.amountDelta));
  }
  const totalCost = round2(
    next.materialCost
      + next.packagingCost
      + next.consumableCost
      + next.laborCost
      + next.deliveryCost
      + next.platformCost
      + next.attributedLossCost,
  );
  const grossProfit = round2(next.revenue - totalCost);
  return {
    ...next,
    totalCost,
    grossProfit,
    grossMargin: ratio(grossProfit, next.revenue),
  };
}

export function buildOrderSnapshotRow(
  base: SnapshotBaseInput,
  items: readonly SnapshotItemInput[] = [],
): OrderSnapshotRow {
  const adjustmentTotal = round2(
    base.adjustments.reduce((sum, adjustment) => sum + num(adjustment.amountDelta), 0),
  );
  const breakdown = applyCostAdjustments(
    {
      revenue: round2(num(base.revenue)),
      materialCost: round2(num(base.materialCost)),
      packagingCost: round2(num(base.packagingCost)),
      consumableCost: round2(num(base.consumableCost)),
      laborCost: round2(num(base.laborCost)),
      deliveryCost: round2(num(base.deliveryCost)),
      platformCost: round2(num(base.platformCost)),
      attributedLossCost: round2(num(base.attributedLossCost)),
    },
    base.adjustments,
  );
  return {
    orderId: base.orderId,
    orderNumber: base.orderNumber,
    revisionNo: base.revisionNo,
    closedAt: base.closedAt,
    estimated: base.estimated,
    commercialState: base.commercialState,
    adjustmentTotal,
    adjustmentCount: base.adjustments.length,
    items: [...items],
    ...breakdown,
  };
}

/**
 * The report always uses the newest cost revision per order. Adjustments are
 * already merged into the row by `buildOrderSnapshotRow`, so only deduplication
 * is required here.
 */
export function selectLatestSnapshotRows(rows: readonly OrderSnapshotRow[]): OrderSnapshotRow[] {
  const latest = new Map<string, OrderSnapshotRow>();
  for (const row of rows) {
    const current = latest.get(row.orderId);
    if (!current || row.revisionNo > current.revisionNo) latest.set(row.orderId, row);
  }
  return [...latest.values()];
}

export type SnapshotSummary = {
  revenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  paidOrderCount: number;
  averageOrderValue: number;
  averageGrossProfitPerOrder: number;
  estimatedSnapshotCount: number;
  adjustmentTotal: number;
};

export type CostStructure = {
  totalCost: number;
  materialCost: number;
  packagingCost: number;
  consumableCost: number;
  laborCost: number;
  deliveryCost: number;
  platformCost: number;
  attributedLossCost: number;
  ratios: {
    materialCost: number;
    packagingCost: number;
    consumableCost: number;
    laborCost: number;
    deliveryCost: number;
    platformCost: number;
    attributedLossCost: number;
  };
};

export function summarizeSnapshots(rows: readonly OrderSnapshotRow[]): {
  summary: SnapshotSummary;
  costStructure: CostStructure;
} {
  const revenue = round2(rows.reduce((sum, row) => sum + row.revenue, 0));
  const totalCost = round2(rows.reduce((sum, row) => sum + row.totalCost, 0));
  const grossProfit = round2(revenue - totalCost);
  const materialCost = round2(rows.reduce((sum, row) => sum + row.materialCost, 0));
  const packagingCost = round2(rows.reduce((sum, row) => sum + row.packagingCost, 0));
  const consumableCost = round2(rows.reduce((sum, row) => sum + row.consumableCost, 0));
  const laborCost = round2(rows.reduce((sum, row) => sum + row.laborCost, 0));
  const deliveryCost = round2(rows.reduce((sum, row) => sum + row.deliveryCost, 0));
  const platformCost = round2(rows.reduce((sum, row) => sum + row.platformCost, 0));
  const attributedLossCost = round2(rows.reduce((sum, row) => sum + row.attributedLossCost, 0));
  return {
    summary: {
      revenue,
      totalCost,
      grossProfit,
      grossMargin: ratio(grossProfit, revenue),
      paidOrderCount: rows.length,
      averageOrderValue: round2(ratio(revenue, rows.length)),
      averageGrossProfitPerOrder: round2(ratio(grossProfit, rows.length)),
      estimatedSnapshotCount: rows.filter((row) => row.estimated).length,
      adjustmentTotal: round2(rows.reduce((sum, row) => sum + row.adjustmentTotal, 0)),
    },
    costStructure: {
      totalCost,
      materialCost,
      packagingCost,
      consumableCost,
      laborCost,
      deliveryCost,
      platformCost,
      attributedLossCost,
      ratios: {
        materialCost: ratio(materialCost, totalCost),
        packagingCost: ratio(packagingCost, totalCost),
        consumableCost: ratio(consumableCost, totalCost),
        laborCost: ratio(laborCost, totalCost),
        deliveryCost: ratio(deliveryCost, totalCost),
        platformCost: ratio(platformCost, totalCost),
        attributedLossCost: ratio(attributedLossCost, totalCost),
      },
    },
  };
}

export type DailySalesRow = {
  date: string;
  revenue: number;
  orderCount: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
};

/** Fills every calendar day in the selected range with a zero row when empty. */
export function buildDailySalesRows(
  rows: readonly OrderSnapshotRow[],
  range: ReportRange,
): DailySalesRow[] {
  const byDate = new Map<string, { revenue: number; orderCount: number; totalCost: number }>();
  for (const day of reportDateKeys(range)) {
    byDate.set(day, { revenue: 0, orderCount: 0, totalCost: 0 });
  }
  for (const row of rows) {
    const key = formatDateInAppTimezoneIso(row.closedAt);
    const bucket = byDate.get(key);
    if (!bucket) continue;
    bucket.revenue += row.revenue;
    bucket.orderCount += 1;
    bucket.totalCost += row.totalCost;
  }
  return [...byDate.entries()].map(([date, bucket]) => {
    const revenue = round2(bucket.revenue);
    const totalCost = round2(bucket.totalCost);
    const grossProfit = round2(revenue - totalCost);
    return {
      date,
      revenue,
      orderCount: bucket.orderCount,
      totalCost,
      grossProfit,
      grossMargin: ratio(grossProfit, revenue),
    };
  });
}

export type ProductMarginRow = {
  skuId: string | null;
  productName: string;
  skuName: string;
  quantity: number;
  revenue: number;
  allocatedCost: number;
  grossProfit: number;
  grossMargin: number;
};

/**
 * Allocates each order's snapshot cost to its items by item revenue share. When
 * an order has zero item revenue, quantity share is used so cost is never lost.
 * The last item absorbs the rounding remainder, so the rows of one order always
 * add up to that order's snapshot total cost.
 */
export function buildProductMarginRows(rows: readonly OrderSnapshotRow[]): ProductMarginRow[] {
  const bySku = new Map<string, ProductMarginRow>();
  for (const order of rows) {
    const itemRevenue = order.items.map((item) =>
      round2(item.quantity * num(item.unitPrice)),
    );
    const revenueTotal = round2(itemRevenue.reduce((sum, value) => sum + value, 0));
    const quantityTotal = order.items.reduce((sum, item) => sum + item.quantity, 0);
    let allocatedSoFar = 0;
    order.items.forEach((item, index) => {
      const itemRevenueValue = itemRevenue[index] ?? 0;
      const isLastItem = index === order.items.length - 1;
      const allocatedCost = isLastItem
        ? round2(order.totalCost - allocatedSoFar)
        : round2(order.totalCost * (
          revenueTotal > 0
            ? itemRevenueValue / revenueTotal
            : quantityTotal > 0
              ? item.quantity / quantityTotal
              : 0
        ));
      allocatedSoFar = round2(allocatedSoFar + allocatedCost);
      const key = item.skuId ?? `item:${item.productName}:${item.skuName}`;
      const current = bySku.get(key) ?? {
        skuId: item.skuId,
        productName: item.productName,
        skuName: item.skuName,
        quantity: 0,
        revenue: 0,
        allocatedCost: 0,
        grossProfit: 0,
        grossMargin: 0,
      };
      current.quantity += item.quantity;
      current.revenue = round2(current.revenue + itemRevenueValue);
      current.allocatedCost = round2(current.allocatedCost + allocatedCost);
      current.grossProfit = round2(current.revenue - current.allocatedCost);
      current.grossMargin = ratio(current.grossProfit, current.revenue);
      bySku.set(key, current);
    });
  }
  return [...bySku.values()].sort((left, right) => right.revenue - left.revenue);
}

export type LowMarginOrderRow = {
  orderId: string;
  orderNumber: string;
  closedAt: Date;
  commercialState: string;
  revenue: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  estimated: boolean;
};

export function buildLowMarginRows(
  rows: readonly OrderSnapshotRow[],
  threshold: number,
): LowMarginOrderRow[] {
  const safeThreshold = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.35;
  return rows
    .filter((row) => row.revenue > 0 && row.grossMargin < safeThreshold)
    .sort((left, right) => left.grossMargin - right.grossMargin)
    .map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      closedAt: row.closedAt,
      commercialState: row.commercialState,
      revenue: row.revenue,
      totalCost: row.totalCost,
      grossProfit: row.grossProfit,
      grossMargin: row.grossMargin,
      estimated: row.estimated,
    }));
}

export const DEFAULT_STANDARD_USABLE_RATE = 0.85;

/** Matches the V1 loss-model guard: a usable rate below 10% is not meaningful. */
export function normalizeUsableRate(value: unknown): number {
  const parsed = num(value);
  let rate = parsed;
  if (parsed > 1 && parsed <= 100) rate = parsed / 100;
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_STANDARD_USABLE_RATE;
  return Math.min(1, Math.max(0.1, rate));
}

export type MaterialUsageInput = {
  materialId: string;
  materialName: string;
  usedQty: number;
  unitCost: number;
  usableRate?: number | null;
};

export type LossModelImpactRow = {
  materialId: string;
  materialName: string;
  usedQty: number;
  rawCost: number;
  lossAdjustedCost: number;
  lossModelExtraCost: number;
  usableRate: number;
};

export type LossModelImpact = {
  rawFlowerMaterialCost: number;
  lossAdjustedFlowerMaterialCost: number;
  lossModelExtraCost: number;
  lossModelExtraCostRatioToRevenue: number;
  topMaterials: LossModelImpactRow[];
};

export function buildLossModelImpact(
  usages: readonly MaterialUsageInput[],
  revenue: number,
): LossModelImpact {
  const byMaterial = new Map<string, LossModelImpactRow>();
  for (const usage of usages) {
    const usedQty = Math.max(0, num(usage.usedQty));
    if (usedQty === 0) continue;
    const rawCost = round2(usedQty * num(usage.unitCost));
    const rate = normalizeUsableRate(usage.usableRate);
    const lossAdjustedCost = round2(rawCost / rate);
    const current = byMaterial.get(usage.materialId) ?? {
      materialId: usage.materialId,
      materialName: usage.materialName,
      usedQty: 0,
      rawCost: 0,
      lossAdjustedCost: 0,
      lossModelExtraCost: 0,
      usableRate: rate,
    };
    current.usedQty = round2(current.usedQty + usedQty);
    current.rawCost = round2(current.rawCost + rawCost);
    current.lossAdjustedCost = round2(current.lossAdjustedCost + lossAdjustedCost);
    current.lossModelExtraCost = round2(current.lossAdjustedCost - current.rawCost);
    current.usableRate = rate;
    byMaterial.set(usage.materialId, current);
  }
  const rows = [...byMaterial.values()];
  const raw = round2(rows.reduce((sum, row) => sum + row.rawCost, 0));
  const adjusted = round2(rows.reduce((sum, row) => sum + row.lossAdjustedCost, 0));
  const extra = round2(adjusted - raw);
  return {
    rawFlowerMaterialCost: raw,
    lossAdjustedFlowerMaterialCost: adjusted,
    lossModelExtraCost: extra,
    lossModelExtraCostRatioToRevenue: ratio(extra, num(revenue)),
    topMaterials: rows
      .sort((left, right) => right.lossModelExtraCost - left.lossModelExtraCost)
      .slice(0, 10),
  };
}

export type InventoryBatchInput = {
  id: string;
  batchNo: string;
  usableUntil: Date | null;
  unitCost: number;
  onHandQty: number;
  frozenQty: number;
  reservedQty: number;
};

export type InventoryMaterialInput = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  safetyStockThreshold: number;
  standardUnitCost: number;
  batches: readonly InventoryBatchInput[];
};

export type InventoryAlertLevel = "OUT_OF_STOCK" | "LOW" | "EXPIRING" | "NORMAL";

export type InventoryAlertRow = {
  materialId: string;
  code: string;
  name: string;
  baseUnit: string;
  onHandQty: number;
  frozenQty: number;
  reservedQty: number;
  availableQty: number;
  threshold: number;
  inventoryValue: number;
  batchCount: number;
  expiringBatchCount: number;
  alertLevel: InventoryAlertLevel;
  reason: string;
};

export type ExpiringBatchRow = {
  batchId: string;
  batchNo: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  usableUntil: Date;
  onHandQty: number;
  unitCost: number;
  expired: boolean;
};

export type InventoryReport = {
  alerts: InventoryAlertRow[];
  expiring: ExpiringBatchRow[];
  materialCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringBatchCount: number;
  totalInventoryValue: number;
};

/**
 * Builds current-stock alerts and an expiry list. Current stock is a snapshot,
 * so this report intentionally ignores the date range while every event-based
 * report uses the shared range from `resolveReportRange`.
 */
export function buildInventoryReport(
  materials: readonly InventoryMaterialInput[],
  now: Date,
  expiryDays = 7,
): InventoryReport {
  const horizon = now.getTime() + expiryDays * 86_400_000;
  const alerts: InventoryAlertRow[] = [];
  const expiring: ExpiringBatchRow[] = [];
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalInventoryValue = 0;

  for (const material of materials) {
    let onHandQty = 0;
    let frozenQty = 0;
    let reservedQty = 0;
    let inventoryValue = 0;
    let expiringBatchCount = 0;
    for (const batch of material.batches) {
      const onHand = Math.max(0, num(batch.onHandQty));
      onHandQty += onHand;
      frozenQty += Math.max(0, num(batch.frozenQty));
      reservedQty += Math.max(0, num(batch.reservedQty));
      inventoryValue += onHand * num(batch.unitCost);
      if (onHand > 0 && batch.usableUntil && batch.usableUntil.getTime() <= horizon) {
        expiringBatchCount += 1;
        expiring.push({
          batchId: batch.id,
          batchNo: batch.batchNo,
          materialId: material.id,
          materialCode: material.code,
          materialName: material.name,
          baseUnit: material.baseUnit,
          usableUntil: batch.usableUntil,
          onHandQty: round2(onHand),
          unitCost: num(batch.unitCost),
          expired: batch.usableUntil.getTime() < now.getTime(),
        });
      }
    }
    const availableQty = Math.max(0, onHandQty - frozenQty - reservedQty);
    const threshold = num(material.safetyStockThreshold);
    const lowStock = threshold > 0 ? onHandQty < threshold : onHandQty <= 0;
    totalInventoryValue += inventoryValue;
    if (onHandQty <= 0) outOfStockCount += 1;
    if (lowStock) lowStockCount += 1;
    const alertLevel: InventoryAlertLevel =
      onHandQty <= 0 ? "OUT_OF_STOCK" : lowStock ? "LOW" : expiringBatchCount > 0 ? "EXPIRING" : "NORMAL";
    if (alertLevel === "NORMAL") continue;
    alerts.push({
      materialId: material.id,
      code: material.code,
      name: material.name,
      baseUnit: material.baseUnit,
      onHandQty: round2(onHandQty),
      frozenQty: round2(frozenQty),
      reservedQty: round2(reservedQty),
      availableQty: round2(availableQty),
      threshold,
      inventoryValue: round2(inventoryValue),
      batchCount: material.batches.length,
      expiringBatchCount,
      alertLevel,
      reason:
        alertLevel === "OUT_OF_STOCK"
          ? "无实存"
          : alertLevel === "LOW"
            ? `低于安全库存 ${threshold}${material.baseUnit}`
            : `${expiringBatchCount} 个批次 ${expiryDays} 天内到期`,
    });
  }

  return {
    alerts: alerts.sort((left, right) => {
      const rank: Record<InventoryAlertLevel, number> = { OUT_OF_STOCK: 0, LOW: 1, EXPIRING: 2, NORMAL: 3 };
      return rank[left.alertLevel] - rank[right.alertLevel] || right.inventoryValue - left.inventoryValue;
    }),
    expiring: expiring.sort((left, right) => left.usableUntil.getTime() - right.usableUntil.getTime()),
    materialCount: materials.length,
    lowStockCount,
    outOfStockCount,
    expiringBatchCount: expiring.length,
    totalInventoryValue: round2(totalInventoryValue),
  };
}

export type PurchaseReceiptInput = {
  disposition: "ACCEPTED" | "DOWNGRADED" | "REJECTED";
  quantity: number;
  receivedAt: Date;
  finalUnitCost: number | null;
  batch: {
    id: string;
    batchNo: string;
    unitCost: number;
    onHandQty: number;
    usedQty: number;
  } | null;
};

export type PurchaseLineInput = {
  purchaseOrderId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  orderedAt: Date;
  state: string;
  freightCost: number;
  packagingCost: number;
  otherCost: number;
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  orderedQty: number;
  expectedBaseQty: number | null;
  unitPrice: number;
  receipts: readonly PurchaseReceiptInput[];
};

export type PurchaseSupplierRow = {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  orderedQty: number;
  receivedQty: number;
  rejectedQty: number;
  receivedValue: number;
  rejectedRate: number;
};

export type PurchasePriceTrendRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  month: string;
  receivedQty: number;
  averageUnitCost: number;
};

export type PurchaseBatchConversionRow = {
  batchId: string;
  batchNo: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  receivedQty: number;
  usedQty: number;
  onHandQty: number;
  conversionRate: number;
};

export type PurchaseReport = {
  orderCount: number;
  lineCount: number;
  /** Goods value: sum of ordered quantity × unit price, before purchase fees. */
  orderedValue: number;
  freightTotal: number;
  packagingTotal: number;
  otherFeeTotal: number;
  feeTotal: number;
  /** Goods value plus freight, packaging and other purchase fees. */
  orderedValueWithFees: number;
  receivedValue: number;
  receivedQty: number;
  rejectedQty: number;
  rejectionRate: number;
  suppliers: PurchaseSupplierRow[];
  priceTrend: PurchasePriceTrendRow[];
  batchConversions: PurchaseBatchConversionRow[];
  lines: PurchaseLineInput[];
};

function monthKey(value: Date): string {
  return formatDateInAppTimezoneIso(value).slice(0, 7);
}

export function buildPurchaseReport(lines: readonly PurchaseLineInput[]): PurchaseReport {
  const orders = new Map<
    string,
    { orderedValue: number; freight: number; packaging: number; other: number }
  >();
  const suppliers = new Map<string, PurchaseSupplierRow>();
  const prices = new Map<string, PurchasePriceTrendRow & { weightedCost: number }>();
  const batches = new Map<string, PurchaseBatchConversionRow>();
  const supplierOrderIds = new Map<string, Set<string>>();
  let receivedQty = 0;
  let rejectedQty = 0;
  let receivedValue = 0;

  for (const line of lines) {
    const order = orders.get(line.purchaseOrderId)
      ?? { orderedValue: 0, freight: 0, packaging: 0, other: 0 };
    order.orderedValue += num(line.orderedQty) * num(line.unitPrice);
    order.freight = num(line.freightCost);
    order.packaging = num(line.packagingCost);
    order.other = num(line.otherCost);
    orders.set(line.purchaseOrderId, order);

    const orderIds = supplierOrderIds.get(line.supplierId) ?? new Set<string>();
    orderIds.add(line.purchaseOrderId);
    supplierOrderIds.set(line.supplierId, orderIds);

    const supplier = suppliers.get(line.supplierId) ?? {
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      orderCount: 0,
      orderedQty: 0,
      receivedQty: 0,
      rejectedQty: 0,
      receivedValue: 0,
      rejectedRate: 0,
    };
    supplier.orderCount = orderIds.size;
    supplier.orderedQty += num(line.expectedBaseQty ?? line.orderedQty);
    suppliers.set(line.supplierId, supplier);

    for (const receipt of line.receipts) {
      const quantity = Math.max(0, num(receipt.quantity));
      if (receipt.disposition === "REJECTED") {
        rejectedQty += quantity;
        supplier.rejectedQty += quantity;
        continue;
      }
      receivedQty += quantity;
      supplier.receivedQty += quantity;
      const unitCost = receipt.finalUnitCost ?? line.unitPrice;
      const value = quantity * num(unitCost);
      receivedValue += value;
      supplier.receivedValue += value;

      const priceKey = `${line.materialId}:${monthKey(receipt.receivedAt)}`;
      const price = prices.get(priceKey) ?? {
        materialId: line.materialId,
        materialCode: line.materialCode,
        materialName: line.materialName,
        baseUnit: line.baseUnit,
        month: monthKey(receipt.receivedAt),
        receivedQty: 0,
        averageUnitCost: 0,
        weightedCost: 0,
      };
      price.receivedQty += quantity;
      price.weightedCost += value;
      price.averageUnitCost = round4(ratio(price.weightedCost, price.receivedQty));
      prices.set(priceKey, price);

      if (receipt.batch) {
        const batch = batches.get(receipt.batch.id) ?? {
          batchId: receipt.batch.id,
          batchNo: receipt.batch.batchNo,
          materialId: line.materialId,
          materialCode: line.materialCode,
          materialName: line.materialName,
          baseUnit: line.baseUnit,
          receivedQty: 0,
          usedQty: 0,
          onHandQty: 0,
          conversionRate: 0,
        };
        batch.receivedQty = round2(batch.receivedQty + quantity);
        batch.usedQty = num(receipt.batch.usedQty);
        batch.onHandQty = num(receipt.batch.onHandQty);
        batch.conversionRate = ratio(batch.usedQty, batch.usedQty + batch.onHandQty);
        batches.set(receipt.batch.id, batch);
      }
    }
  }

  for (const supplier of suppliers.values()) {
    supplier.orderedQty = round2(supplier.orderedQty);
    supplier.receivedQty = round2(supplier.receivedQty);
    supplier.rejectedQty = round2(supplier.rejectedQty);
    supplier.receivedValue = round2(supplier.receivedValue);
    supplier.rejectedRate = ratio(supplier.rejectedQty, supplier.receivedQty + supplier.rejectedQty);
  }

  const orderedValue = round2(
    [...orders.values()].reduce((sum, order) => sum + order.orderedValue, 0),
  );
  // Purchase-level fees are counted once per order, not once per line.
  const freightTotal = round2(
    [...orders.values()].reduce((sum, order) => sum + order.freight, 0),
  );
  const packagingTotal = round2(
    [...orders.values()].reduce((sum, order) => sum + order.packaging, 0),
  );
  const otherFeeTotal = round2(
    [...orders.values()].reduce((sum, order) => sum + order.other, 0),
  );
  const feeTotal = round2(freightTotal + packagingTotal + otherFeeTotal);

  return {
    orderCount: orders.size,
    lineCount: lines.length,
    orderedValue,
    freightTotal,
    packagingTotal,
    otherFeeTotal,
    feeTotal,
    orderedValueWithFees: round2(orderedValue + feeTotal),
    receivedValue: round2(receivedValue),
    receivedQty: round2(receivedQty),
    rejectedQty: round2(rejectedQty),
    rejectionRate: ratio(rejectedQty, receivedQty + rejectedQty),
    suppliers: [...suppliers.values()].sort((left, right) => right.receivedValue - left.receivedValue),
    priceTrend: [...prices.values()]
      .sort((left, right) => right.month.localeCompare(left.month)
        || left.materialName.localeCompare(right.materialName))
      .slice(0, 60),
    batchConversions: [...batches.values()]
      .sort((left, right) => right.conversionRate - left.conversionRate)
      .slice(0, 60)
      .map((row) => ({
        ...row,
        receivedQty: round2(row.receivedQty),
        usedQty: round2(row.usedQty),
        onHandQty: round2(row.onHandQty),
      })),
    lines: [...lines],
  };
}

export type LossReasonRow = {
  reason: string;
  quantity: number;
  estimatedCost: number;
  recordCount: number;
};

export type LossDetailRow = {
  id: string;
  occurredAt: Date;
  materialName: string;
  batchNo: string | null;
  reason: string;
  quantity: number;
  estimatedCost: number;
  orderId: string | null;
  orderNumber: string | null;
};

export type LossReport = {
  totalQuantity: number;
  estimatedCost: number;
  byReason: LossReasonRow[];
  details: LossDetailRow[];
  materialUsage: Array<{
    materialId: string;
    materialName: string;
    baseUnit: string;
    quantityUsed: number;
    quantityLost: number;
    totalCost: number;
    averageUnitCost: number;
    orderCount: number;
  }>;
  materialCount: number;
};

export type LossRecordInput = {
  id: string;
  occurredAt: Date;
  reason: string;
  quantity: number;
  materialName: string;
  baseUnit: string;
  unitCost: number;
  batchNo: string | null;
  orderId: string | null;
  orderNumber: string | null;
};

export type MaterialUsageRowInput = {
  materialId: string;
  materialName: string;
  baseUnit: string;
  usedQty: number;
  lostQty: number;
  returnedQty: number;
  unitCost: number;
  orderId: string;
};

export function buildLossReport(
  losses: readonly LossRecordInput[],
  usages: readonly MaterialUsageRowInput[],
): LossReport {
  const byReason = new Map<string, LossReasonRow>();
  const details: LossDetailRow[] = [];
  let totalQuantity = 0;
  let estimatedCost = 0;
  for (const loss of losses) {
    const quantity = Math.max(0, num(loss.quantity));
    const cost = round2(quantity * num(loss.unitCost));
    totalQuantity += quantity;
    estimatedCost += cost;
    const reason = byReason.get(loss.reason) ?? {
      reason: loss.reason,
      quantity: 0,
      estimatedCost: 0,
      recordCount: 0,
    };
    reason.quantity = round2(reason.quantity + quantity);
    reason.estimatedCost = round2(reason.estimatedCost + cost);
    reason.recordCount += 1;
    byReason.set(loss.reason, reason);
    details.push({
      id: loss.id,
      occurredAt: loss.occurredAt,
      materialName: loss.materialName,
      batchNo: loss.batchNo,
      reason: loss.reason,
      quantity: round2(quantity),
      estimatedCost: cost,
      orderId: loss.orderId,
      orderNumber: loss.orderNumber,
    });
  }

  const byMaterial = new Map<string, {
    materialId: string;
    materialName: string;
    baseUnit: string;
    quantityUsed: number;
    quantityLost: number;
    totalCost: number;
    averageUnitCost: number;
    orderCount: number;
    orderIds: Set<string>;
  }>();
  for (const usage of usages) {
    const current = byMaterial.get(usage.materialId) ?? {
      materialId: usage.materialId,
      materialName: usage.materialName,
      baseUnit: usage.baseUnit,
      quantityUsed: 0,
      quantityLost: 0,
      totalCost: 0,
      averageUnitCost: 0,
      orderCount: 0,
      orderIds: new Set<string>(),
    };
    current.quantityUsed = round2(current.quantityUsed + Math.max(0, num(usage.usedQty)));
    current.quantityLost = round2(current.quantityLost + Math.max(0, num(usage.lostQty)));
    current.totalCost = round2(current.totalCost + Math.max(0, num(usage.usedQty)) * num(usage.unitCost));
    current.orderIds.add(usage.orderId);
    current.orderCount = current.orderIds.size;
    current.averageUnitCost = round4(ratio(current.totalCost, current.quantityUsed));
    byMaterial.set(usage.materialId, current);
  }

  return {
    totalQuantity: round2(totalQuantity),
    estimatedCost: round2(estimatedCost),
    byReason: [...byReason.values()].sort((left, right) => right.estimatedCost - left.estimatedCost),
    details: details.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()),
    materialUsage: [...byMaterial.values()]
      .map((row) => ({
        materialId: row.materialId,
        materialName: row.materialName,
        baseUnit: row.baseUnit,
        quantityUsed: row.quantityUsed,
        quantityLost: row.quantityLost,
        totalCost: row.totalCost,
        averageUnitCost: row.averageUnitCost,
        orderCount: row.orderCount,
      }))
      .sort((left, right) => right.quantityUsed - left.quantityUsed),
    materialCount: byMaterial.size,
  };
}

export function formatReportQuantity(value: unknown): string {
  const parsed = num(value);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Today loss rate = loss quantity / (consumed quantity + loss quantity). */
export function computeLossRate(lossQty: number, consumedQty: number): number {
  const loss = Math.max(0, num(lossQty));
  const consumed = Math.max(0, num(consumedQty));
  return ratio(loss, loss + consumed);
}

/** V1 low-stock rule: positive threshold compares on-hand; zero warns only at zero. */
export function isLowStock(onHandQty: number, threshold: number): boolean {
  return threshold > 0 ? onHandQty < threshold : onHandQty <= 0;
}
