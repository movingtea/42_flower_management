/** Quantities are expressed in each material's base inventory unit. */
export type Requirement = {
  materialId: string;
  quantity: number;
  needBy: Date;
};

export type AvailableBatch = {
  batchId: string;
  materialId: string;
  onHand: number;
  frozen: number;
  orderReserved: number;
  sampleReserved: number;
  usableUntil: Date | null;
  receivedAt: Date;
};

export type BatchAllocation = {
  batchId: string;
  quantity: number;
};

export type AllocationResult = {
  allocations: BatchAllocation[];
  shortage: number;
};

function assertQuantity(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Quantity must be finite and nonnegative");
  }
}

export function assertMaterialQuantity(quantity: number, quantityScale: number): void {
  assertQuantity(quantity);
  if (!Number.isInteger(quantityScale) || quantityScale < 0 || quantityScale > 3) {
    throw new Error("Unsupported material quantity scale");
  }
  const scaled = quantity * 10 ** quantityScale;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    throw new Error("Quantity does not match the material base unit");
  }
}

export function availableQuantity(batch: AvailableBatch): number {
  for (const value of [batch.onHand, batch.frozen, batch.orderReserved, batch.sampleReserved]) {
    assertQuantity(value);
  }
  return Math.max(
    0,
    batch.onHand - batch.frozen - batch.orderReserved - batch.sampleReserved,
  );
}

/** FEFO when dated, otherwise FIFO. Never allocates expired or wrong-grade material. */
export function allocateBatches(
  requirement: Requirement,
  batches: readonly AvailableBatch[],
): AllocationResult {
  assertQuantity(requirement.quantity);
  if (!Number.isFinite(requirement.needBy.getTime())) {
    throw new Error("Invalid material need-by time");
  }
  const eligible = batches
    .filter((batch) => batch.materialId === requirement.materialId)
    .filter((batch) => !batch.usableUntil || batch.usableUntil >= requirement.needBy)
    .sort((left, right) => {
      if (left.usableUntil && right.usableUntil) {
        const expiry = left.usableUntil.getTime() - right.usableUntil.getTime();
        if (expiry !== 0) return expiry;
      } else if (left.usableUntil) {
        return -1;
      } else if (right.usableUntil) {
        return 1;
      }
      return left.receivedAt.getTime() - right.receivedAt.getTime() ||
        left.batchId.localeCompare(right.batchId);
    });

  let remaining = requirement.quantity;
  const allocations: BatchAllocation[] = [];
  for (const batch of eligible) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, availableQuantity(batch));
    if (quantity <= 0) continue;
    allocations.push({ batchId: batch.batchId, quantity });
    remaining -= quantity;
  }
  return { allocations, shortage: Math.max(0, remaining) };
}

export type RecipeIngredient = {
  materialId: string;
  perUnitQuantity: number;
  expectedLossRate: number;
  reservePerOrder: boolean;
  quantityScale: number;
};

export function expandRecipe(
  ingredients: readonly RecipeIngredient[],
  productQuantity: number,
  needBy: Date,
): Requirement[] {
  if (!Number.isInteger(productQuantity) || productQuantity <= 0) {
    throw new Error("Product quantity must be a positive integer");
  }
  const totals = new Map<string, number>();
  for (const ingredient of ingredients) {
    assertQuantity(ingredient.perUnitQuantity);
    if (!Number.isFinite(ingredient.expectedLossRate) ||
      ingredient.expectedLossRate < 0 || ingredient.expectedLossRate >= 1) {
      throw new Error("Expected loss rate must be in [0, 1)");
    }
    if (!ingredient.reservePerOrder) continue;
    assertMaterialQuantity(ingredient.perUnitQuantity, ingredient.quantityScale);
    const factor = 10 ** ingredient.quantityScale;
    const gross = Math.ceil(
      ingredient.perUnitQuantity * productQuantity / (1 - ingredient.expectedLossRate) * factor - 1e-8,
    ) / factor;
    totals.set(ingredient.materialId, (totals.get(ingredient.materialId) ?? 0) + gross);
  }
  return [...totals].map(([materialId, quantity]) => ({ materialId, quantity, needBy }));
}
