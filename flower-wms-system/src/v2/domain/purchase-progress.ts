/**
 * Pure purchase-progress rules.
 *
 * This module deliberately has no Prisma or package imports so it can be used by services,
 * scripts and focused unit tests without a database connection. All quantities are expressed in
 * the purchase line's base inventory unit.
 */

export const EPSILON = 1e-8;

export type ReceiptDisposition = "ACCEPTED" | "DOWNGRADED" | "REJECTED";

export type PurchaseReceiptRow = {
  disposition: ReceiptDisposition;
  quantity: number;
};

export type PurchaseProgressState = "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED";

export type PurchaseProgress = {
  acceptedOriginalQty: number;
  downgradedQty: number;
  rejectedQty: number;
  processedQty: number;
  remainingQty: number;
  state: PurchaseProgressState;
  hasRejection: boolean;
};

/** Domain progress plus the expected base quantity it was calculated against. */
export type PurchaseProgressWithExpected = PurchaseProgress & {
  expectedBaseQty: number;
};

function assertExpectedBaseQty(expectedBaseQty: number): void {
  if (!Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) {
    throw new Error("采购基础数量必须为有效正数");
  }
}

function assertReceiptRow(row: PurchaseReceiptRow): void {
  if (row.disposition !== "ACCEPTED" &&
      row.disposition !== "DOWNGRADED" &&
      row.disposition !== "REJECTED") {
    throw new Error("收货明细处置类型无效");
  }
  if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
    throw new Error("收货明细数量必须为有效正数");
  }
}

/**
 * Aggregates all receipt rows for one purchase line.
 *
 * `processedQty` is the sum of accepted-original, downgraded and rejected rows, so a rejected
 * quantity consumes purchase capacity even though it never creates inventory. The line reaches
 * RECEIVED when processed quantity reaches the expected base quantity, including the all-rejected
 * case. A tiny tolerance absorbs decimal/floating-point storage noise.
 */
export function calculatePurchaseProgress(
  expectedBaseQty: number,
  rows: readonly PurchaseReceiptRow[],
): PurchaseProgress {
  assertExpectedBaseQty(expectedBaseQty);

  let acceptedOriginalQty = 0;
  let downgradedQty = 0;
  let rejectedQty = 0;
  for (const row of rows) {
    assertReceiptRow(row);
    if (row.disposition === "ACCEPTED") acceptedOriginalQty += row.quantity;
    else if (row.disposition === "DOWNGRADED") downgradedQty += row.quantity;
    else rejectedQty += row.quantity;
  }

  const processedQty = acceptedOriginalQty + downgradedQty + rejectedQty;
  const remainingQty = Math.max(0, expectedBaseQty - processedQty);
  const state: PurchaseProgressState = processedQty <= EPSILON
    ? "ORDERED"
    : remainingQty <= EPSILON
      ? "RECEIVED"
      : "PARTIALLY_RECEIVED";

  return {
    acceptedOriginalQty,
    downgradedQty,
    rejectedQty,
    processedQty,
    remainingQty,
    state,
    hasRejection: rejectedQty > EPSILON,
  };
}

/**
 * Validates that one more receipt action still fits within the expected purchase quantity.
 *
 * The optional disposition is used only to produce an accurate preview breakdown; callers that
 * omit it get an ACCEPTED preview. The returned progress already includes the incoming quantity.
 */
export function assertPurchaseCapacity(
  expectedBaseQty: number,
  rows: readonly PurchaseReceiptRow[],
  incomingQty: number,
  actionLabel?: string,
  incomingDisposition: ReceiptDisposition = "ACCEPTED",
): PurchaseProgress {
  if (!Number.isFinite(incomingQty) || incomingQty <= 0) {
    throw new Error("本次处理数量必须为有效正数");
  }

  const current = calculatePurchaseProgress(expectedBaseQty, rows);
  if (current.processedQty + incomingQty > expectedBaseQty + EPSILON) {
    const label = actionLabel ? `（${actionLabel}）` : "";
    throw new Error(`累计处理数量将超过采购基础数量 ${expectedBaseQty}${label}`);
  }

  return calculatePurchaseProgress(expectedBaseQty, [
    ...rows,
    { disposition: incomingDisposition, quantity: incomingQty },
  ]);
}

/**
 * Resolves the base quantity a purchase line is allowed to process.
 *
 * `expectedBaseQty` is authoritative when present. A null value may only fall back to
 * `orderedQty` when the purchase unit already equals the material base unit; otherwise the data
 * cannot be converted safely and the caller must fix the purchase line before receiving.
 */
export function resolveExpectedBaseQty(
  expectedBaseQty: number | null | undefined,
  orderedQty: number,
  purchaseUnit: string,
  materialBaseUnit: string,
): number {
  if (expectedBaseQty !== null && expectedBaseQty !== undefined) {
    if (!Number.isFinite(expectedBaseQty) || expectedBaseQty <= 0) {
      throw new Error("采购明细缺少有效的基础单位数量");
    }
    return expectedBaseQty;
  }
  if (purchaseUnit !== materialBaseUnit ||
      !Number.isFinite(orderedQty) ||
      orderedQty <= 0) {
    throw new Error("采购明细缺少有效的基础单位数量");
  }
  return orderedQty;
}

/** Returns the literal purchase state represented by a progress result. */
export function nextPurchaseState(progress: PurchaseProgress): PurchaseProgressState {
  switch (progress.state) {
    case "ORDERED":
    case "PARTIALLY_RECEIVED":
    case "RECEIVED":
      return progress.state;
    default:
      throw new Error("采购进度状态无效");
  }
}
