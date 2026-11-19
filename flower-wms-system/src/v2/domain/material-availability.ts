/** Current batch availability inputs, all quantities in the material's base unit. */
export type BatchAvailability = {
  onHand: number;
  frozen: number;
  orderReserved: number;
  sampleReserved: number;
};

export type MaterialAvailabilityTotals = {
  onHandQty: number;
  frozenQty: number;
  orderReservedQty: number;
  sampleReservedQty: number;
  /** Sum of each batch's non-negative availability. */
  availableQty: number;
};

function assertQuantity(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be finite and nonnegative`);
  }
}

/**
 * Aggregates the existing V2 batch availability model. Per-batch availability is clamped at
 * zero, so an over-reserved batch can never create positive availability by offsetting another.
 */
export function summarizeMaterialAvailability(
  batches: readonly BatchAvailability[],
): MaterialAvailabilityTotals {
  const totals: MaterialAvailabilityTotals = {
    onHandQty: 0,
    frozenQty: 0,
    orderReservedQty: 0,
    sampleReservedQty: 0,
    availableQty: 0,
  };
  for (const batch of batches) {
    assertQuantity(batch.onHand, "On-hand quantity");
    assertQuantity(batch.frozen, "Frozen quantity");
    assertQuantity(batch.orderReserved, "Order-reserved quantity");
    assertQuantity(batch.sampleReserved, "Sample-reserved quantity");
    totals.onHandQty += batch.onHand;
    totals.frozenQty += batch.frozen;
    totals.orderReservedQty += batch.orderReserved;
    totals.sampleReservedQty += batch.sampleReserved;
    totals.availableQty += Math.max(
      0,
      batch.onHand - batch.frozen - batch.orderReserved - batch.sampleReserved,
    );
  }
  return totals;
}
