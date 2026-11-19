const EDITABLE_COMMERCIAL_STATES = new Set(["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"]);
const PRE_PRODUCTION_STATES = new Set(["NOT_SCHEDULED", "WAITING_MATERIAL", "READY"]);
const STARTED_TASK_STATES = new Set(["IN_PROGRESS", "COMPLETED", "EXCEPTION"]);

/**
 * Chinese labels and URL filter values for the order board. The enum member stays the value
 * so the server can filter with a strict equality; only the rendering text is localized.
 */
export const COMMERCIAL_STATE_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_CONFIRMATION: "待确认",
  PENDING_PAYMENT: "待付款",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
};

export const SUPPLY_STATE_LABELS: Record<string, string> = {
  NOT_EVALUATED: "未评估",
  ON_HAND_COVERED: "现货覆盖",
  INBOUND_COVERED: "在途覆盖",
  PURCHASE_REQUIRED: "待采购",
  SUBSTITUTION_REQUIRED: "待替换",
  PARTIALLY_COVERED: "部分覆盖",
  UNFULFILLABLE: "无法满足",
};

export const PRODUCTION_STATE_LABELS: Record<string, string> = {
  NOT_SCHEDULED: "未排产",
  WAITING_MATERIAL: "待备料",
  READY: "可制作",
  IN_PROGRESS: "制作中",
  COMPLETED: "已完成",
  EXCEPTION: "制作异常",
};

export const FULFILLMENT_STATE_LABELS: Record<string, string> = {
  UNPLANNED: "未安排",
  WAITING_PICKUP: "待自提",
  WAITING_DELIVERY: "待配送",
  DELIVERING: "配送中",
  DELIVERED: "已交付",
  FAILED: "配送异常",
};

export const DELIVERY_ATTEMPT_STATE_LABELS: Record<string, string> = {
  SCHEDULED: "待出发",
  OUT_FOR_DELIVERY: "配送途中",
  DELIVERED: "已送达",
  FAILED: "配送失败",
};

export const COST_KIND_LABELS: Record<string, string> = {
  MATERIAL: "花材",
  PACKAGING: "包装",
  CONSUMABLE: "耗材",
  LABOR: "人工",
  DELIVERY: "配送",
  PLATFORM: "平台",
  LOSS: "损耗",
};

export const COST_STAGE_LABELS: Record<string, string> = {
  STANDARD: "标准",
  PLANNED: "计划",
  ACTUAL: "实际",
};

export function commercialStateLabel(state: string): string {
  return COMMERCIAL_STATE_LABELS[state] ?? state;
}
export function supplyStateLabel(state: string): string {
  return SUPPLY_STATE_LABELS[state] ?? state;
}
export function productionStateLabel(state: string): string {
  return PRODUCTION_STATE_LABELS[state] ?? state;
}
export function fulfillmentStateLabel(state: string): string {
  return FULFILLMENT_STATE_LABELS[state] ?? state;
}
export function deliveryAttemptStateLabel(state: string): string {
  return DELIVERY_ATTEMPT_STATE_LABELS[state] ?? state;
}
export function costKindLabel(kind: string): string {
  return COST_KIND_LABELS[kind] ?? kind;
}
export function costStageLabel(stage: string): string {
  return COST_STAGE_LABELS[stage] ?? stage;
}

export const COMMERCIAL_FILTER_OPTIONS = Object.entries(COMMERCIAL_STATE_LABELS)
  .map(([value, label]) => ({ value, label }));
export const SUPPLY_FILTER_OPTIONS = Object.entries(SUPPLY_STATE_LABELS)
  .map(([value, label]) => ({ value, label }));
export const PRODUCTION_FILTER_OPTIONS = Object.entries(PRODUCTION_STATE_LABELS)
  .map(([value, label]) => ({ value, label }));
export const FULFILLMENT_FILTER_OPTIONS = Object.entries(FULFILLMENT_STATE_LABELS)
  .map(([value, label]) => ({ value, label }));

export type OrderFilterValues = {
  q?: string;
  deliveryDate?: string;
  commercial?: string;
  supply?: string;
  production?: string;
  fulfillment?: string;
};

export type OrderBoardColumnId =
  | "pending"
  | "production"
  | "in_progress"
  | "ready"
  | "delivering"
  | "failed"
  | "archive";

export type OrderBoardColumn = {
  id: OrderBoardColumnId;
  title: string;
  accentClass: string;
  badgeClass: string;
};

/** V1-style fulfilment lanes in operational order, ending with one merged history lane. */
export const ORDER_BOARD_COLUMNS: readonly OrderBoardColumn[] = [
  {
    id: "pending",
    title: "待确认",
    accentClass: "border-amber-200 bg-amber-50/80",
    badgeClass: "bg-amber-100 text-amber-900",
  },
  {
    id: "production",
    title: "待制作",
    accentClass: "border-sky-200 bg-sky-50/80",
    badgeClass: "bg-sky-100 text-sky-900",
  },
  {
    id: "in_progress",
    title: "制作中",
    accentClass: "border-violet-200 bg-violet-50/80",
    badgeClass: "bg-violet-100 text-violet-900",
  },
  {
    id: "ready",
    title: "待交付 / 自提 / 配送",
    accentClass: "border-teal-200 bg-teal-50/80",
    badgeClass: "bg-teal-100 text-teal-900",
  },
  {
    id: "delivering",
    title: "配送中",
    accentClass: "border-orange-200 bg-orange-50/80",
    badgeClass: "bg-orange-100 text-orange-900",
  },
  {
    id: "failed",
    title: "配送异常",
    accentClass: "border-rose-200 bg-rose-50/80",
    badgeClass: "bg-rose-100 text-rose-900",
  },
  {
    id: "archive",
    title: "已完成 / 历史归档",
    accentClass: "border-zinc-300 bg-zinc-100/90",
    badgeClass: "bg-zinc-200 text-zinc-800",
  },
];

export type OrderBoardLike = {
  commercialState: string;
  productionState: string;
  fulfillmentState: string;
};

/**
 * A single order belongs to exactly one lane. Terminal commercial states and handed-over
 * orders collapse into history; delivery problems win over the happy-path production lanes.
 */
export function orderBoardStage(order: OrderBoardLike): OrderBoardColumnId {
  if (order.commercialState === "CANCELLED" ||
      order.commercialState === "CLOSED" ||
      order.fulfillmentState === "DELIVERED") {
    return "archive";
  }
  if (order.fulfillmentState === "FAILED") return "failed";
  if (order.fulfillmentState === "DELIVERING") return "delivering";
  if (order.fulfillmentState === "WAITING_PICKUP" ||
      order.fulfillmentState === "WAITING_DELIVERY") {
    return "ready";
  }
  if (order.productionState === "COMPLETED") return "ready";
  if (order.productionState === "IN_PROGRESS" ||
      order.productionState === "EXCEPTION") {
    return "in_progress";
  }
  if (order.commercialState === "CONFIRMED") return "production";
  return "pending";
}

export function groupOrdersByBoardStage<T extends OrderBoardLike>(
  orders: readonly T[],
): { column: OrderBoardColumn; orders: T[] }[] {
  return ORDER_BOARD_COLUMNS.map((column) => ({
    column,
    orders: orders.filter((order) => orderBoardStage(order) === column.id),
  }));
}

/** Calendar key in the operational Asia/Shanghai timezone, or null for missing/invalid dates. */
export function appDateKey(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function orderDeliveryDateKey(order: { deliveryAt: Date | null }): string | null {
  return appDateKey(order.deliveryAt);
}

export type OrderFilterMatchSource = OrderBoardLike & {
  number: string;
  supplyState: string;
  buyerNameSnapshot: string | null;
  buyerPhoneSnapshot: string | null;
  recipientNameSnapshot: string | null;
  recipientPhoneSnapshot: string | null;
  deliveryAt: Date | null;
};

/**
 * Shared semantics for the URL filters: keyword matches order number/customer contact fields,
 * date matches the Asia/Shanghai calendar day, and status filters are strict enum values.
 */
export function matchesOrderFilters(
  order: OrderFilterMatchSource,
  filters: OrderFilterValues,
): boolean {
  const keyword = filters.q?.trim().toLocaleLowerCase("zh-CN") ?? "";
  if (keyword) {
    const haystack = [
      order.number,
      order.buyerNameSnapshot,
      order.buyerPhoneSnapshot,
      order.recipientNameSnapshot,
      order.recipientPhoneSnapshot,
    ];
    if (!haystack.some((value) =>
      (value ?? "").toLocaleLowerCase("zh-CN").includes(keyword))) {
      return false;
    }
  }
  if (filters.deliveryDate && orderDeliveryDateKey(order) !== filters.deliveryDate) {
    return false;
  }
  if (filters.commercial && order.commercialState !== filters.commercial) return false;
  if (filters.supply && order.supplyState !== filters.supply) return false;
  if (filters.production && order.productionState !== filters.production) return false;
  if (filters.fulfillment && order.fulfillmentState !== filters.fulfillment) return false;
  return true;
}

/** Copy buttons must never render for an empty/whitespace-only value. */
export function hasCopyValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function canConfirmOrder(order: { commercialState: string }): boolean {
  return order.commercialState === "DRAFT" ||
    order.commercialState === "PENDING_CONFIRMATION";
}

export function canStartProduction(order: OrderBoardLike & { supplyState: string }): boolean {
  return order.commercialState === "CONFIRMED" &&
    order.supplyState === "ON_HAND_COVERED" &&
    order.productionState === "READY" &&
    order.fulfillmentState !== "DELIVERED";
}

export function canFinishProduction(order: OrderBoardLike & { supplyState: string }): boolean {
  return order.commercialState === "CONFIRMED" &&
    order.supplyState === "ON_HAND_COVERED" &&
    (order.productionState === "READY" || order.productionState === "IN_PROGRESS");
}

export function canRecordActualUsage(
  order: OrderBoardLike & { supplyState: string },
  reservedLineCount: number,
): boolean {
  return canFinishProduction(order) && reservedLineCount > 0;
}

export function canCompleteDelivery(order: OrderBoardLike): boolean {
  return order.commercialState === "CONFIRMED" &&
    order.productionState === "COMPLETED" &&
    (order.fulfillmentState === "WAITING_PICKUP" ||
      order.fulfillmentState === "WAITING_DELIVERY" ||
      order.fulfillmentState === "DELIVERING");
}

export function canCancelOrder(order: OrderBoardLike): boolean {
  if (order.commercialState === "CANCELLED" ||
      order.commercialState === "CLOSED" ||
      order.fulfillmentState === "DELIVERED") {
    return false;
  }
  // Once production has actually started, cancelling is a financial/stock exception,
  // not a normal lifecycle action; the dedicated service rejects it as well.
  return order.productionState !== "IN_PROGRESS" &&
    order.productionState !== "COMPLETED" &&
    order.productionState !== "EXCEPTION";
}

export function canCloseOrder(order: OrderBoardLike): boolean {
  return order.commercialState === "CONFIRMED" &&
    order.fulfillmentState === "DELIVERED";
}

export function deliveryAttemptActionFlags(attempt: { state: string }): {
  start: boolean;
  fail: boolean;
  reschedule: boolean;
} {
  return {
    start: attempt.state === "SCHEDULED",
    fail: attempt.state === "OUT_FOR_DELIVERY",
    reschedule: attempt.state === "FAILED",
  };
}

export function orderTotalCents(order: {
  items: { quantity: number; unitPrice: unknown }[];
  fulfillment?: { deliveryFeeCharged: unknown } | null;
}): number {
  const items = order.items.reduce(
    (sum, item) => sum + item.quantity * Math.round(Number(item.unitPrice) * 100),
    0,
  );
  const deliveryFee = order.fulfillment
    ? Math.round(Number(order.fulfillment.deliveryFeeCharged) * 100)
    : 0;
  return items + (Number.isFinite(deliveryFee) ? deliveryFee : 0);
}

/** Excludes MINI_PROGRAM: staff may only record money that was received offline. */
export const OFFLINE_PAYMENT_OPTIONS = [
  { value: "CASH", label: "现金" },
  { value: "BANK_TRANSFER", label: "银行转账" },
  { value: "CARD", label: "刷卡" },
  { value: "WECHAT_TRANSFER", label: "微信转账" },
  { value: "OTHER", label: "其他线下方式" },
] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  MINI_PROGRAM: "小程序",
  CASH: "现金",
  BANK_TRANSFER: "银行转账",
  CARD: "刷卡",
  WECHAT_TRANSFER: "微信转账",
  OTHER: "其他",
};

export function isV2ManualOrder(order: { createdVia: string }): boolean {
  return order.createdVia === "STAFF_PORTAL";
}

export function paymentRefundedCents(payment: {
  refunds: { state: string; amount: unknown }[];
}): number {
  return payment.refunds
    .filter((refund) => refund.state === "SUCCEEDED")
    .reduce((sum, refund) => sum + Math.round(Number(refund.amount) * 100), 0);
}

export function refundablePaymentCents(payment: {
  amount: unknown;
  refunds: { state: string; amount: unknown }[];
}): number {
  return Math.max(0, Math.round(Number(payment.amount) * 100) - paymentRefundedCents(payment));
}

export function costAdjustmentCents(adjustments: { amountDelta: unknown }[]): number {
  return adjustments.reduce((sum, adjustment) => sum + Math.round(Number(adjustment.amountDelta) * 100), 0);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatAmount(value: unknown): string {
  return formatCents(Math.round(Number(value) * 100));
}

export function formatSignedCents(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCents(cents)}`;
}

export function formatAdjustment(value: unknown): string {
  return formatSignedCents(Math.round(Number(value) * 100));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function auditSummary(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null;
  const summary = snapshot.summary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary : null;
}

export type RevisionCandidate = {
  commercialState: string;
  productionState: string;
  fulfillmentState: string;
  fulfillment: { handedOverAt: Date | null } | null;
  items: {
    id: string;
    nameSnapshot: string;
    kind: string;
    quantity: number;
    tasks: { id: string; state: string; startedAt: Date | null; completedAt: Date | null }[];
    requirements: {
      revisionId: string;
      material: { code: string; name: string; baseUnit: string; quantityScale: number };
      reservations: {
        batchId: string;
        state: string;
        quantity: unknown;
        batch: { batchNo: string } | null;
      }[];
    }[];
  }[];
  revisions: { id: string; number: number }[];
};

export type ReservedBatchLine = {
  taskId: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  materialCode: string;
  materialName: string;
  baseUnit: string;
  quantityScale: number;
  quantity: number;
};

/** Mirrors reviseManualOrder's pre-production gate so the form is only offered when it can succeed. */
export function canReviseOrder(order: RevisionCandidate): boolean {
  if (order.items.length < 1 || order.items.length > 20 || order.revisions.length === 0) return false;
  if (!EDITABLE_COMMERCIAL_STATES.has(order.commercialState)) return false;
  if (!PRE_PRODUCTION_STATES.has(order.productionState)) return false;
  if (order.fulfillmentState === "DELIVERED" || order.fulfillment?.handedOverAt) return false;
  return order.items.every((item) => {
    if (item.kind !== "STANDARD") return false;
    return item.tasks.every((task) =>
      !task.startedAt && !task.completedAt && !STARTED_TASK_STATES.has(task.state));
  });
}

/**
 * Latest active reservations only, grouped per task + batch exactly as completeProduction
 * expects. The same batch may back several production tasks, so task identity is part of
 * the usage row rather than collapsed into the batch.
 */
export function latestReservedBatchLines(order: RevisionCandidate): ReservedBatchLine[] {
  const latestRevision = order.revisions[0];
  if (!latestRevision) return [];
  const byTaskBatch = new Map<string, ReservedBatchLine>();
  for (const item of order.items) {
    const task = item.tasks[0];
    if (!task) continue;
    for (const requirement of item.requirements) {
      if (requirement.revisionId !== latestRevision.id) continue;
      for (const reservation of requirement.reservations) {
        if (reservation.state !== "ACTIVE") continue;
        const quantity = Number(reservation.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) continue;
        const key = `${task.id}\u0000${reservation.batchId}`;
        const existing = byTaskBatch.get(key);
        if (existing) {
          existing.quantity += quantity;
          continue;
        }
        byTaskBatch.set(key, {
          taskId: task.id,
          itemId: item.id,
          itemName: item.nameSnapshot,
          batchId: reservation.batchId,
          batchNo: reservation.batch?.batchNo ?? reservation.batchId,
          materialCode: requirement.material.code,
          materialName: requirement.material.name,
          baseUnit: requirement.material.baseUnit,
          quantityScale: requirement.material.quantityScale,
          quantity,
        });
      }
    }
  }
  return [...byTaskBatch.values()].sort((left, right) =>
    left.materialCode.localeCompare(right.materialCode, "zh-CN") ||
    left.batchNo.localeCompare(right.batchNo, "zh-CN"));
}

export function toDateTimeLocalValue(value: Date | null): string {
  if (!value) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function formatOrderDate(value: Date | null): string {
  if (!value) return "未定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(value);
}

export function quantityStep(scale: number): number {
  return scale > 0 ? Number(`1e-${scale}`) : 1;
}
