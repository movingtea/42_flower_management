import {
  CommercialState, CostKind, CostStage, FulfillmentKind,
  type PrismaClient,
} from "../../generated/prisma-v2/client";

/**
 * Canonical order cost kinds. The order matters: it is also the order of `missingKinds`.
 */
export type OrderCostKindKey =
  | "MATERIAL"
  | "PACKAGING"
  | "CONSUMABLE"
  | "LABOR"
  | "DELIVERY"
  | "PLATFORM"
  | "LOSS";

const COST_KINDS: readonly OrderCostKindKey[] = [
  "MATERIAL",
  "PACKAGING",
  "CONSUMABLE",
  "LABOR",
  "DELIVERY",
  "PLATFORM",
  "LOSS",
];

export type OrderCostBreakdown = {
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
  estimated: boolean;
  missingKinds: OrderCostKindKey[];
};

const DELIVERY_COST_SOURCE = "DELIVERY_ATTEMPT";
const DEFAULT_ADJUSTMENT_REASON = "配送实际成本更新";
const MAX_AMOUNT_CENTS = 99_999_999_999_999; // Decimal(14, 2)

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}不能为空`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${label}不能为空`);
  return trimmed;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}格式无效`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  // Prisma Decimal / DecimalJsLike values reach the pure calculation directly from database rows.
  if (typeof value === "object" && value !== null) {
    try {
      const text = String(value);
      if (text.trim().length > 0) {
        const parsed = Number(text);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      // Fall through to the shared invalid-number error.
    }
  }
  throw new Error(`${label}必须为有效数字`);
}

/**
 * Rounds a money value to cents. Accepts Prisma Decimal, numbers and numeric strings.
 * Negative amounts are rejected: every cost component is a non-negative amount.
 */
function nonnegativeCents(value: unknown, label: string): number {
  const amount = finiteNumber(value, label);
  if (amount < 0) throw new Error(`${label}不能为负数`);
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6) throw new Error(`${label}最多保留两位小数`);
  if (cents > MAX_AMOUNT_CENTS) throw new Error(`${label}超出可记录范围`);
  return cents;
}

/** Reads an amount that is already stored in the database and rounds it to cents. */
function storedCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("已记录的成本金额无效");
  return Math.round(amount * 100);
}

function centsToAmount(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function centsToNumber(cents: number): number {
  return cents / 100;
}

/**
 * Builds the immutable cost picture used by completion snapshots and staff reports.
 *
 * Only ACTUAL cost entries are aggregated. A DELIVERY order without a DELIVERY entry falls back
 * to the fulfilment's actual cost and then to its estimate; estimated and missing components are
 * both marked so a snapshot can never silently claim final numbers.
 */
export function calculateOrderCostBreakdown(input: {
  items: {
    quantity: number;
    unitPrice: unknown;
    estimatedConsumableCostSnapshot: unknown;
    estimatedLaborCostSnapshot: unknown;
  }[];
  fulfillment: {
    kind: string;
    deliveryFeeCharged: unknown;
    deliveryCostActual: unknown | null;
    deliveryCostEstimated: unknown | null;
  } | null;
  entries: { kind: string; stage: string; amount: unknown; estimated: boolean }[];
}): OrderCostBreakdown {
  const cents = new Map<OrderCostKindKey, number>();
  let estimated = false;

  for (const entry of input.entries) {
    if (entry.stage !== CostStage.ACTUAL && entry.stage !== "ACTUAL") continue;
    if (!COST_KINDS.includes(entry.kind as OrderCostKindKey)) continue;
    const kind = entry.kind as OrderCostKindKey;
    cents.set(kind, (cents.get(kind) ?? 0) + nonnegativeCents(entry.amount, "成本金额"));
    if (entry.estimated) estimated = true;
  }

  const missingKinds: OrderCostKindKey[] = [];

  // Delivery is the one component with a fallback outside CostEntry. Never add the entry and the
  // fulfilment fallback together, otherwise the actual cost would be counted twice.
  if (!cents.has("DELIVERY")) {
    if (input.fulfillment && input.fulfillment.kind === FulfillmentKind.DELIVERY) {
      if (input.fulfillment.deliveryCostActual !== null
          && input.fulfillment.deliveryCostActual !== undefined) {
        cents.set("DELIVERY", nonnegativeCents(input.fulfillment.deliveryCostActual, "配送实际成本"));
      } else if (input.fulfillment.deliveryCostEstimated !== null
          && input.fulfillment.deliveryCostEstimated !== undefined) {
        cents.set("DELIVERY", nonnegativeCents(input.fulfillment.deliveryCostEstimated, "配送预计成本"));
        estimated = true;
      }
    } else if (input.fulfillment && input.fulfillment.kind !== FulfillmentKind.DELIVERY) {
      // Pickup has no delivery component by definition; zero is a known amount, not missing data.
      cents.set("DELIVERY", 0);
    }
  }

  for (const kind of COST_KINDS) {
    if (!cents.has(kind)) missingKinds.push(kind);
  }
  if (missingKinds.length > 0) estimated = true;

  let revenueCents = 0;
  for (const item of input.items) {
    const quantity = finiteNumber(item.quantity, "商品数量");
    if (quantity < 0) throw new Error("商品数量不能为负数");
    const unitPriceCents = nonnegativeCents(item.unitPrice, "商品单价");
    revenueCents += Math.round(unitPriceCents * quantity);
  }
  if (input.fulfillment) {
    revenueCents += nonnegativeCents(input.fulfillment.deliveryFeeCharged, "配送费用");
  }

  const totalCostCents = COST_KINDS.reduce((sum, kind) => sum + (cents.get(kind) ?? 0), 0);
  const grossProfitCents = revenueCents - totalCostCents;

  return {
    revenue: centsToNumber(revenueCents),
    materialCost: centsToNumber(cents.get("MATERIAL") ?? 0),
    packagingCost: centsToNumber(cents.get("PACKAGING") ?? 0),
    consumableCost: centsToNumber(cents.get("CONSUMABLE") ?? 0),
    laborCost: centsToNumber(cents.get("LABOR") ?? 0),
    deliveryCost: centsToNumber(cents.get("DELIVERY") ?? 0),
    platformCost: centsToNumber(cents.get("PLATFORM") ?? 0),
    attributedLossCost: centsToNumber(cents.get("LOSS") ?? 0),
    totalCost: centsToNumber(totalCostCents),
    grossProfit: centsToNumber(grossProfitCents),
    grossMargin: revenueCents > 0 ? grossProfitCents / revenueCents : 0,
    estimated,
    missingKinds,
  };
}

export type RecordDeliveryCostInput = {
  tenantId: string;
  storeId: string;
  orderId: string;
  actorStaffId: string;
  attemptId?: string | null;
  amount: number | string;
  note?: string | null;
};

export type RecordDeliveryCostResult = {
  orderId: string;
  attemptId: string;
  amount: number;
  note: string | null;
  costEntryId: string;
  adjustmentId: string | null;
  snapshotRevisionNo: number | null;
};

/**
 * Records the actual delivery cost against one attempt.
 *
 * Open orders only receive the CostEntry (the completion snapshot will include it). Closed orders
 * keep their immutable snapshot and receive a signed DELIVERY CostAdjustment for the difference
 * against the previous delivery entry. The order row is always locked first so two staff members
 * cannot create conflicting entries or adjustments.
 */
export async function recordDeliveryActualCost(
  db: PrismaClient,
  input: RecordDeliveryCostInput,
): Promise<RecordDeliveryCostResult> {
  const tenantId = requiredText(input.tenantId, "租户");
  const storeId = requiredText(input.storeId, "门店");
  const orderId = requiredText(input.orderId, "订单");
  const actorStaffId = requiredText(input.actorStaffId, "操作人");
  const amountCents = nonnegativeCents(input.amount, "配送实际成本");
  const note = optionalText(input.note, "备注");
  const requestedAttemptId = optionalText(input.attemptId, "配送尝试");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        fulfillment: {
          include: { attempts: { orderBy: { attemptNo: "desc" } } },
        },
      },
    });
    if (!order || order.tenantId !== tenantId || order.storeId !== storeId) {
      throw new Error("订单不存在");
    }
    if (!order.fulfillment) throw new Error("缺少交付方式");
    if (order.fulfillment.kind !== FulfillmentKind.DELIVERY) {
      throw new Error("仅配送订单可登记配送实际成本");
    }
    if (order.commercialState === CommercialState.CANCELLED) {
      throw new Error("已取消订单不能登记配送实际成本");
    }

    const attempt = requestedAttemptId
      ? order.fulfillment.attempts.find((row) => row.id === requestedAttemptId)
      : order.fulfillment.attempts.find((row) => row.state !== "FAILED");
    if (!attempt) {
      throw new Error(requestedAttemptId ? "配送尝试不存在" : "缺少配送尝试，请先创建配送尝试");
    }

    await tx.fulfillment.update({
      where: { id: order.fulfillment.id },
      data: { deliveryCostActual: centsToAmount(amountCents) },
    });
    await tx.deliveryAttempt.update({
      where: { id: attempt.id },
      data: { deliveryCost: centsToAmount(amountCents) },
    });

    const existingEntries = await tx.costEntry.findMany({
      where: {
        orderId,
        kind: CostKind.DELIVERY,
        stage: CostStage.ACTUAL,
        sourceType: DELIVERY_COST_SOURCE,
        sourceId: attempt.id,
      },
      orderBy: { id: "asc" },
    });
    const existingCents = existingEntries.reduce((sum, entry) => sum + storedCents(entry.amount), 0);

    let costEntryId: string;
    if (existingEntries.length > 0) {
      costEntryId = existingEntries[0].id;
      await tx.costEntry.updateMany({
        where: { id: { in: existingEntries.map((entry) => entry.id) } },
        data: {
          amount: centsToAmount(amountCents),
          estimated: false,
          calculatedAt: new Date(),
        },
      });
    } else {
      const created = await tx.costEntry.create({
        data: {
          orderId,
          kind: CostKind.DELIVERY,
          stage: CostStage.ACTUAL,
          amount: centsToAmount(amountCents),
          estimated: false,
          sourceType: DELIVERY_COST_SOURCE,
          sourceId: attempt.id,
        },
      });
      costEntryId = created.id;
    }

    // The latest snapshot is the only legal target. Snapshots themselves are never rewritten; all
    // later corrections are appended as signed adjustments so history stays auditable.
    const snapshot = await tx.orderCostSnapshot.findFirst({
      where: { orderId },
      orderBy: { revisionNo: "desc" },
    });
    // When this attempt has no entry yet, the snapshot already contains either its estimate or a
    // previous delivery amount. Diffing against the snapshot prevents adding that amount twice.
    const previousCents = existingEntries.length > 0
      ? existingCents
      : snapshot
        ? storedCents(snapshot.deliveryCost)
        : 0;
    let adjustmentId: string | null = null;
    if (snapshot) {
      const deltaCents = amountCents - previousCents;
      if (deltaCents !== 0) {
        const adjustment = await tx.costAdjustment.create({
          data: {
            orderId,
            snapshotId: snapshot.id,
            kind: CostKind.DELIVERY,
            amountDelta: centsToAmount(deltaCents),
            reason: note ?? DEFAULT_ADJUSTMENT_REASON,
            sourceType: DELIVERY_COST_SOURCE,
            sourceId: attempt.id,
          },
        });
        adjustmentId = adjustment.id;
      }
    }

    await tx.auditEvent.create({
      data: {
        tenantId,
        storeId,
        actorStaffId,
        action: "DELIVERY_COST_RECORDED",
        entityType: "DeliveryAttempt",
        entityId: attempt.id,
        beforeSnapshot: { amount: centsToNumber(previousCents) },
        afterSnapshot: {
          orderId,
          attemptId: attempt.id,
          attemptNo: attempt.attemptNo,
          amount: centsToNumber(amountCents),
          note,
          costEntryId,
          adjustmentId,
          snapshotRevisionNo: snapshot?.revisionNo ?? null,
        },
      },
    });

    return {
      orderId,
      attemptId: attempt.id,
      amount: centsToNumber(amountCents),
      note,
      costEntryId,
      adjustmentId,
      snapshotRevisionNo: snapshot?.revisionNo ?? null,
    };
  }, { timeout: 30_000 });
}
