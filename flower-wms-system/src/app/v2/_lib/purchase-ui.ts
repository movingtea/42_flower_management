/** Pure presentation helpers for the V2 purchase/receiving and shortage screens. */

export const PURCHASE_EPSILON = 1e-8;

/** Quantities are base-unit decimals with at most three fractional digits. */
export function formatQuantity(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return String(Number(parsed.toFixed(3)));
}

export function formatQuantityWithUnit(value: unknown, unit: string): string {
  return `${formatQuantity(value)}${unit}`;
}

/** Rounds a base-unit quantity to the schema's three fractional digits. */
export function roundQuantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(3));
}

/** Input step for a material's quantity scale (0 = whole units). */
export function baseQuantityStep(quantityScale: number): number {
  return Number.isFinite(quantityScale) && quantityScale > 0 ? Number(`1e-${quantityScale}`) : 1;
}

/** Sums Decimal-like values and normalizes the result to base-unit precision. */
export function sumQuantities(values: readonly unknown[]): number {
  let total = 0;
  for (const value of values) {
    const parsed = Number(value ?? 0);
    if (Number.isFinite(parsed)) total += parsed;
  }
  return roundQuantity(total);
}

export type ShortageQuantitySummary = {
  plannedQty: number;
  reservedQty: number;
  allocatedQty: number;
  /** Plan minus active reservations, never below zero. */
  currentShortage: number;
  /** Current shortage not yet attributed to any purchase line. */
  pendingAssociationQty: number;
};

/**
 * Normalizes requirement demand math for display. Quantities arrive as Prisma Decimal or string
 * values; every comparison/render boundary uses rounded base-unit numbers instead of raw floats.
 */
export function summarizeShortageQuantities(input: {
  plannedQty: unknown;
  reservedQtys: readonly unknown[];
  allocatedQtys: readonly unknown[];
}): ShortageQuantitySummary {
  const plannedQty = roundQuantity(input.plannedQty);
  const reservedQty = sumQuantities(input.reservedQtys);
  const allocatedQty = sumQuantities(input.allocatedQtys);
  const currentShortage = Math.max(0, roundQuantity(plannedQty - reservedQty));
  return {
    plannedQty,
    reservedQty,
    allocatedQty,
    currentShortage,
    pendingAssociationQty: Math.max(0, roundQuantity(currentShortage - allocatedQty)),
  };
}

/** Default quantity for one association form: the smaller of pending demand and line capacity. */
export function suggestedAllocationQuantity(
  pendingAssociationQty: unknown,
  allocatableQty: unknown,
): number {
  const pending = roundQuantity(pendingAssociationQty);
  const allocatable = roundQuantity(allocatableQty);
  if (pending <= PURCHASE_EPSILON || allocatable <= PURCHASE_EPSILON) return 0;
  return roundQuantity(Math.min(pending, allocatable));
}

export type ShortageAllocationState = "AVAILABLE" | "LATE_LINE" | "FULLY_ALLOCATED" | "NO_LINE";

/** Chooses the actionable empty state shown for one shortage requirement. */
export function shortageAllocationState(input: {
  sameMaterialLineCount: number;
  availableLineCount: number;
  lateLineCount: number;
}): ShortageAllocationState {
  if (input.availableLineCount > 0) return "AVAILABLE";
  if (input.lateLineCount > 0) return "LATE_LINE";
  if (input.sameMaterialLineCount > 0) return "FULLY_ALLOCATED";
  return "NO_LINE";
}

/** Stable option label for an existing open purchase line on the shortage screen. */
export function purchaseLineAllocationLabel(input: {
  purchaseOrderNumber: string;
  materialCode: string;
  materialName: string;
  allocatableQty: unknown;
  baseUnit: string;
  expectedAt: Date | string | null | undefined;
}): string {
  return `${input.purchaseOrderNumber} · ${input.materialCode} ${input.materialName} · ` +
    `可分配 ${formatQuantity(input.allocatableQty)}${input.baseUnit} · ` +
    `预计到货 ${formatPurchaseDateTime(input.expectedAt)}`;
}

export function formatPurchaseDateTime(value: Date | string | null | undefined): string {
  if (!value) return "未设置";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export const PURCHASE_ORDER_STATE_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  ORDERED: "已下单",
  PARTIALLY_RECEIVED: "部分验收",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

export function purchaseOrderStateLabel(state: string): string {
  return PURCHASE_ORDER_STATE_LABELS[state] ?? state;
}

const SUPPLY_STATE_LABELS: Record<string, string> = {
  NOT_EVALUATED: "未评估",
  ON_HAND_COVERED: "现货覆盖",
  INBOUND_COVERED: "在途覆盖",
  PURCHASE_REQUIRED: "待采购",
  SUBSTITUTION_REQUIRED: "待替换",
  PARTIALLY_COVERED: "部分覆盖",
  UNFULFILLABLE: "无法满足",
};

export function supplyStateLabel(state: string): string {
  return SUPPLY_STATE_LABELS[state] ?? state;
}

const COMMERCIAL_STATE_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待确认",
  PENDING_PAYMENT: "待付款",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

export function commercialStateLabel(state: string): string {
  return COMMERCIAL_STATE_LABELS[state] ?? state;
}

export function isPurchaseOrderOpen(state: string): boolean {
  return state === "ORDERED" || state === "PARTIALLY_RECEIVED";
}

export function isPurchaseLineActionable(state: string, remainingQty: number): boolean {
  return isPurchaseOrderOpen(state) && remainingQty > PURCHASE_EPSILON;
}

/**
 * Progress state labels stay presentation-only. Unknown future domain states fall back to a
 * quantity-derived description so the page never renders an unexplained blank.
 */
export function describeProgressState(progress: {
  state?: string;
  processedQty: number;
  remainingQty: number;
}): string {
  const labels: Record<string, string> = {
    ORDERED: "待验收",
    NOT_RECEIVED: "待验收",
    PENDING: "待验收",
    PARTIAL: "部分验收",
    PARTIALLY_RECEIVED: "部分验收",
    PARTIALLY_PROCESSED: "部分验收",
    RECEIVED: "已全部处理",
    COMPLETE: "已全部处理",
    COMPLETED: "已全部处理",
    PROCESSED: "已全部处理",
  };
  if (progress.state && labels[progress.state]) return labels[progress.state];
  if (progress.processedQty <= PURCHASE_EPSILON) return "待验收";
  if (progress.remainingQty <= PURCHASE_EPSILON) return "已全部处理";
  return "部分验收";
}

export type PurchaseReceiptRow = {
  disposition: "ACCEPTED" | "DOWNGRADED" | "REJECTED";
  quantity: number;
};

/** Normalizes Prisma receipt rows (Decimal quantities, enum dispositions) for the pure domain. */
export function toPurchaseReceiptRows(
  rows: readonly { disposition: string; quantity: unknown }[],
): PurchaseReceiptRow[] {
  return rows.map((row) => {
    if (row.disposition !== "ACCEPTED" &&
        row.disposition !== "DOWNGRADED" &&
        row.disposition !== "REJECTED") {
      throw new Error(`未知验收处置类型：${row.disposition}`);
    }
    return { disposition: row.disposition, quantity: Number(row.quantity) };
  });
}

export type PurchaseLineQuantitySource = {
  orderedQty: unknown;
  purchaseUnit: string;
  expectedBaseQty: unknown;
  material: { baseUnit: string };
};

/** Mirrors allocatePurchaseDemand's fallback for legacy lines without expectedBaseQty. */
export function resolveExpectedBaseQty(line: PurchaseLineQuantitySource): number | null {
  const expected = line.expectedBaseQty === null || line.expectedBaseQty === undefined
    ? null
    : Number(line.expectedBaseQty);
  if (expected !== null && Number.isFinite(expected)) return expected;
  const ordered = Number(line.orderedQty);
  if (Number.isFinite(ordered) && line.purchaseUnit === line.material.baseUnit) return ordered;
  return null;
}

/**
 * Expected base quantity minus every processed receipt disposition (accepted, downgraded and
 * rejected) minus demand already attributed to this purchase line. Rejections consume capacity.
 */
export function outstandingAllocatableQty(
  expectedBaseQty: number,
  processedQty: number,
  allocatedQty: number,
): number {
  if (![expectedBaseQty, processedQty, allocatedQty].every((value) => Number.isFinite(value))) return 0;
  return Math.max(0, expectedBaseQty - processedQty - allocatedQty);
}

export type PurchaseLineEligibility = {
  materialId: string;
  expectedAt: Date | null;
  allocatableQty: number;
};

export function isEligiblePurchaseLine(
  line: PurchaseLineEligibility,
  requirement: { materialId: string; needBy: Date },
): boolean {
  if (line.materialId !== requirement.materialId) return false;
  if (line.allocatableQty <= PURCHASE_EPSILON) return false;
  return !line.expectedAt || line.expectedAt.getTime() <= requirement.needBy.getTime();
}

export function isLatePurchaseLine(
  line: PurchaseLineEligibility,
  requirement: { materialId: string; needBy: Date },
): boolean {
  return line.materialId === requirement.materialId &&
    !!line.expectedAt && line.expectedAt.getTime() > requirement.needBy.getTime();
}

export type ReplacementMaterialOption = {
  material: {
    code: string;
    name: string;
    grade?: string | null;
    color?: string | null;
    specification?: string | null;
  };
  availableQty: number;
};

/** Enough stock for the plan first, then larger availability, then stable material code. */
export function sortReplacementMaterialOptions<T extends ReplacementMaterialOption>(
  options: readonly T[],
  plannedQty: number,
): T[] {
  return [...options].sort((left, right) => {
    const leftSufficient = left.availableQty + PURCHASE_EPSILON >= plannedQty ? 0 : 1;
    const rightSufficient = right.availableQty + PURCHASE_EPSILON >= plannedQty ? 0 : 1;
    if (leftSufficient !== rightSufficient) return leftSufficient - rightSufficient;
    if (right.availableQty !== left.availableQty) return right.availableQty - left.availableQty;
    return left.material.code.localeCompare(right.material.code, "zh-CN");
  });
}

export function materialIdentityLabel(material: {
  code: string;
  name: string;
  grade?: string | null;
  color?: string | null;
  specification?: string | null;
}): string {
  return [
    material.code,
    material.name,
    material.grade,
    material.color,
    material.specification,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" · ");
}
