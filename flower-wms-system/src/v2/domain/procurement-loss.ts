/**
 * Procurement-channel loss model.
 *
 * A channel (supplier) declares an expected unusable share. Receiving keeps the
 * physical quantity and inventory movement unchanged; the loss model only
 * derives the expected usable quantity and the cost per usable base unit so
 * planning, sample forecasts and reporting do not understate real cost.
 *
 * The calculation is deterministic and pure so it can be reused by purchase
 * drafts, receipts, sample planning and reports.
 */

export const PROCUREMENT_LOSS_MAX_RATE = 0.99;
const EPSILON = 1e-8;

export type ProcurementLossInput = {
  quantity: number;
  unitCost: number;
  lossRate: number | null | undefined;
};

export type ProcurementLossResult = {
  quantity: number;
  lossRate: number;
  expectedLossQty: number;
  usableQty: number;
  unitCost: number;
  lossAdjustedUnitCost: number;
};

function round(value: number, scale: number): number {
  const factor = 10 ** scale;
  return Math.round((value + EPSILON) * factor) / factor;
}

/** Validate a persisted/entered loss rate. `null`/`undefined` mean "not set". */
export function normalizeProcurementLossRate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > PROCUREMENT_LOSS_MAX_RATE) {
    throw new Error(`渠道损耗率必须在 0 到 ${PROCUREMENT_LOSS_MAX_RATE} 之间`);
  }
  if (Math.abs(value * 10_000 - Math.round(value * 10_000)) > EPSILON) {
    throw new Error("渠道损耗率最多保留四位小数");
  }
  return value;
}

/**
 * Resolve the loss rate for a purchase line:
 * supplier channel rate -> material default loss rate -> 0.
 * A missing value is never treated as a wildcard; zero is the explicit default.
 */
export function resolveProcurementLossRate(input: {
  supplierRate?: number | null;
  materialRate?: number | null;
}): number {
  const supplier = normalizeProcurementLossRate(input.supplierRate);
  if (supplier !== null) return supplier;
  const material = normalizeProcurementLossRate(input.materialRate);
  return material ?? 0;
}

export function applyProcurementLoss(input: ProcurementLossInput): ProcurementLossResult {
  const quantity = input.quantity;
  const unitCost = input.unitCost;
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("采购数量必须为非负有限数");
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("采购单价必须为非负有限数");
  const lossRate = normalizeProcurementLossRate(input.lossRate) ?? 0;
  const usableQty = round(quantity * (1 - lossRate), 3);
  const expectedLossQty = round(Math.max(0, quantity - usableQty), 3);
  const lossAdjustedUnitCost = lossRate >= 1
    ? 0
    : round(unitCost / (1 - lossRate), 4);
  return {
    quantity: round(quantity, 3),
    lossRate,
    expectedLossQty,
    usableQty,
    unitCost: round(unitCost, 4),
    lossAdjustedUnitCost,
  };
}

export type ProcurementChannelSummary = {
  lossRate: number;
  quantity: number;
  usableQty: number;
  expectedLossQty: number;
  amount: number;
  lossAdjustedAmount: number;
};

/**
 * Weighted channel summary for purchase/reporting screens. Rows are keyed by
 * the snapshotted line loss rate; the amount uses the physical quantity and the
 * loss-adjusted amount uses the cost per usable unit.
 */
export function summarizeProcurementChannels(
  rows: readonly { quantity: number; unitCost: number; lossRate: number | null | undefined }[],
): ProcurementChannelSummary[] {
  const groups = new Map<number, ProcurementChannelSummary>();
  for (const row of rows) {
    const result = applyProcurementLoss({
      quantity: row.quantity,
      unitCost: row.unitCost,
      lossRate: row.lossRate,
    });
    const current = groups.get(result.lossRate) ?? {
      lossRate: result.lossRate,
      quantity: 0,
      usableQty: 0,
      expectedLossQty: 0,
      amount: 0,
      lossAdjustedAmount: 0,
    };
    current.quantity = round(current.quantity + result.quantity, 3);
    current.usableQty = round(current.usableQty + result.usableQty, 3);
    current.expectedLossQty = round(current.expectedLossQty + result.expectedLossQty, 3);
    current.amount = round(current.amount + result.quantity * result.unitCost, 2);
    current.lossAdjustedAmount = round(
      current.lossAdjustedAmount + result.usableQty * result.lossAdjustedUnitCost,
      2,
    );
    groups.set(result.lossRate, current);
  }
  return [...groups.values()].sort((left, right) => left.lossRate - right.lossRate);
}
