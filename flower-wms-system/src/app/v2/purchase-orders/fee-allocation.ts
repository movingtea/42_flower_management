/**
 * Pure preview of how purchase-order fees are spread over the order lines.
 *
 * The server still confirms the real landed cost when goods are received; this
 * helper only answers "what would each line cost if the order settled exactly
 * like this?" for the editor. All money math runs in integer cents so the
 * preview can never drift by a fraction of a cent.
 */
export type FeeAllocationMethod = "BY_AMOUNT" | "BY_QUANTITY";

export type FeeAllocationLineInput = {
  quantity: number;
  unitPrice: number;
};

export type PurchaseFees = {
  freightCost: number;
  packagingCost: number;
  otherCost: number;
};

export type FeeAllocationLineResult = {
  /** Quantity × unit price, rounded to cents. */
  lineAmount: number;
  /** Share of freight + packaging + other fees, rounded to cents. */
  allocatedFee: number;
  /** lineAmount + allocatedFee. */
  actualTotal: number;
  /** actualTotal / quantity, rounded to 4 decimals for the cost columns. */
  actualUnitCost: number;
};

export type FeeAllocationResult = {
  method: FeeAllocationMethod;
  /** Total of freight + packaging + other fees, rounded to cents. */
  feeTotal: number;
  lineAmountTotal: number;
  actualTotal: number;
  lines: FeeAllocationLineResult[];
};

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function toCents(value: unknown): number {
  return Math.round(nonNegative(value) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Allocate total fees across lines, then derive each line's actual total and
 * actual unit cost.
 *
 * - BY_AMOUNT weights lines by quantity × unit price.
 * - BY_QUANTITY weights lines by quantity.
 * - When every weight is zero (all lines empty or free), fees split equally.
 * - Every line except the last is floored to whole cents and the last line
 *   absorbs the remainder, so the allocated fees always add up to the input
 *   fees and no line receives a negative allocation.
 */
export function allocatePurchaseFees(
  lines: readonly FeeAllocationLineInput[],
  fees: PurchaseFees,
  method: FeeAllocationMethod,
): FeeAllocationResult {
  const feeTotalCents = toCents(fees.freightCost) + toCents(fees.packagingCost) + toCents(fees.otherCost);
  const lineAmountCents = lines.map((line) => toCents(nonNegative(line.quantity) * nonNegative(line.unitPrice)));
  const lineAmountTotalCents = lineAmountCents.reduce((sum, cents) => sum + cents, 0);

  const weights = lines.map((line, index) =>
    method === "BY_QUANTITY" ? nonNegative(line.quantity) : fromCents(lineAmountCents[index] ?? 0),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const allocatedFeeCents: number[] = [];
  if (lines.length > 0) {
    if (totalWeight <= 0) {
      const equalShare = Math.floor(feeTotalCents / lines.length);
      for (let index = 0; index < lines.length - 1; index += 1) {
        allocatedFeeCents.push(equalShare);
      }
      allocatedFeeCents.push(feeTotalCents - equalShare * (lines.length - 1));
    } else {
      let allocated = 0;
      for (let index = 0; index < lines.length - 1; index += 1) {
        // Tiny epsilon keeps exact shares (e.g. 500 × 0.2 / 0.2) from flooring
        // one cent low because of binary floating point.
        const share = Math.floor((feeTotalCents * (weights[index] ?? 0)) / totalWeight + 1e-9);
        allocatedFeeCents.push(share);
        allocated += share;
      }
      allocatedFeeCents.push(feeTotalCents - allocated);
    }
  }

  const resultLines: FeeAllocationLineResult[] = lines.map((line, index) => {
    const quantity = nonNegative(line.quantity);
    const amountCents = lineAmountCents[index] ?? 0;
    const feeCents = allocatedFeeCents[index] ?? 0;
    const actualTotalCents = amountCents + feeCents;
    return {
      lineAmount: fromCents(amountCents),
      allocatedFee: fromCents(feeCents),
      actualTotal: fromCents(actualTotalCents),
      actualUnitCost: quantity > 0 ? Number((actualTotalCents / 100 / quantity).toFixed(4)) : 0,
    };
  });

  return {
    method,
    feeTotal: fromCents(feeTotalCents),
    lineAmountTotal: fromCents(lineAmountTotalCents),
    actualTotal: fromCents(lineAmountTotalCents + feeTotalCents),
    lines: resultLines,
  };
}
