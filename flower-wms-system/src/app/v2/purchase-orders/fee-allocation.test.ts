import assert from "node:assert/strict";
import {
  allocatePurchaseFees,
  type FeeAllocationMethod,
  type FeeAllocationLineInput,
  type PurchaseFees,
} from "./fee-allocation";

/**
 * Run with: npx tsx src/app/v2/purchase-orders/fee-allocation.test.ts
 *
 * Pure script test: no database, no server-only imports.
 */

function assertCentsEqual(actual: number, expected: number, label: string): void {
  assert.equal(Math.round(actual * 100), Math.round(expected * 100), label);
}

function allocatedTotal(lines: { allocatedFee: number }[]): number {
  return lines.reduce((sum, line) => sum + line.allocatedFee, 0);
}

function feeTotal(fees: PurchaseFees): number {
  return fees.freightCost + fees.packagingCost + fees.otherCost;
}

function check(lines: readonly FeeAllocationLineInput[], fees: PurchaseFees, method: FeeAllocationMethod): void {
  const result = allocatePurchaseFees(lines, fees, method);
  assertCentsEqual(allocatedTotal(result.lines), feeTotal(fees), `${method} allocations equal input fees`);
  assertCentsEqual(result.feeTotal, feeTotal(fees), `${method} feeTotal`);
  assertCentsEqual(
    result.actualTotal,
    result.lineAmountTotal + result.feeTotal,
    `${method} actual total`,
  );
  for (const line of result.lines) {
    assertCentsEqual(line.actualTotal, line.lineAmount + line.allocatedFee, `${method} line actual total`);
    assert.ok(line.allocatedFee >= 0, `${method} allocation is never negative`);
  }
}

const fees: PurchaseFees = { freightCost: 3, packagingCost: 2, otherCost: 0 };
check([{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }], fees, "BY_AMOUNT");
check([{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }], fees, "BY_QUANTITY");

// BY_AMOUNT: 20 / 5 split, 5 yuan of fees becomes 4.00 / 1.00.
{
  const result = allocatePurchaseFees(
    [{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }],
    fees,
    "BY_AMOUNT",
  );
  assert.deepEqual(result.lines.map((line) => line.allocatedFee), [4, 1]);
  assert.deepEqual(result.lines.map((line) => line.lineAmount), [20, 5]);
  assert.deepEqual(result.lines.map((line) => line.actualTotal), [24, 6]);
  assert.deepEqual(result.lines.map((line) => line.actualUnitCost), [12, 6]);
  assert.equal(result.lineAmountTotal, 25);
  assert.equal(result.actualTotal, 30);
  check([{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }], fees, "BY_AMOUNT");
}

// BY_QUANTITY: 2 / 1 split, 5 yuan of fees becomes 3.333… floored to 333 and 167 in cents.
{
  const result = allocatePurchaseFees(
    [{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }],
    fees,
    "BY_QUANTITY",
  );
  assert.deepEqual(result.lines.map((line) => line.allocatedFee), [3.33, 1.67]);
  assert.deepEqual(result.lines.map((line) => line.actualTotal), [23.33, 6.67]);
  assert.equal(result.lines[0]?.actualUnitCost, 11.665);
  assert.equal(result.lines[1]?.actualUnitCost, 6.67);
  assert.equal(allocatedTotal(result.lines), 5);
}

// Rounding: 0.10 over three equal lines cannot be split evenly; the last line
// absorbs the odd cent so the allocation total still matches the input fees.
{
  const result = allocatePurchaseFees(
    [{ quantity: 1, unitPrice: 1 }, { quantity: 1, unitPrice: 1 }, { quantity: 1, unitPrice: 1 }],
    { freightCost: 0.1, packagingCost: 0, otherCost: 0 },
    "BY_AMOUNT",
  );
  assert.deepEqual(result.lines.map((line) => line.allocatedFee), [0.03, 0.03, 0.04]);
  assert.equal(allocatedTotal(result.lines), 0.1);
}

// Zero total weight: free / empty lines fall back to an equal split.
{
  const zeroLines = [
    { quantity: 0, unitPrice: 0 },
    { quantity: 0, unitPrice: 0 },
    { quantity: 0, unitPrice: 0 },
  ];
  for (const method of ["BY_AMOUNT", "BY_QUANTITY"] as const) {
    const result = allocatePurchaseFees(zeroLines, { freightCost: 0.1, packagingCost: 0, otherCost: 0 }, method);
    assert.deepEqual(result.lines.map((line) => line.allocatedFee), [0.03, 0.03, 0.04], `${method} equal split`);
    assert.deepEqual(result.lines.map((line) => line.actualUnitCost), [0, 0, 0], `${method} zero unit cost`);
    assert.equal(result.actualTotal, 0.1, `${method} fee-only total`);
  }
}

// Zero fees keep every actual total equal to the line amount.
{
  const result = allocatePurchaseFees(
    [{ quantity: 1, unitPrice: 12.34 }, { quantity: 2, unitPrice: 0.5 }],
    { freightCost: 0, packagingCost: 0, otherCost: 0 },
    "BY_AMOUNT",
  );
  assert.deepEqual(result.lines.map((line) => line.allocatedFee), [0, 0]);
  assert.deepEqual(result.lines.map((line) => line.actualTotal), [12.34, 1]);
  assert.equal(result.actualTotal, 13.34);
}

// Fractional quantities still round to whole cents and a 4-decimal unit cost.
{
  const result = allocatePurchaseFees(
    [{ quantity: 3, unitPrice: 1 }],
    { freightCost: 1, packagingCost: 0, otherCost: 0 },
    "BY_QUANTITY",
  );
  assert.equal(result.lines[0]?.allocatedFee, 1);
  assert.equal(result.lines[0]?.actualTotal, 4);
  assert.equal(result.lines[0]?.actualUnitCost, 1.3333);
}

// Negative or non-finite input is treated as zero rather than poisoning totals.
{
  const result = allocatePurchaseFees(
    [{ quantity: -2, unitPrice: 10 }, { quantity: Number.NaN, unitPrice: 5 }],
    { freightCost: -3, packagingCost: 2, otherCost: Number.NaN },
    "BY_AMOUNT",
  );
  assert.equal(result.feeTotal, 2);
  assert.deepEqual(result.lines.map((line) => line.allocatedFee), [1, 1]);
  assert.equal(allocatedTotal(result.lines), 2);
}

// Empty order: no line breakdown, but the fee total is still reported.
{
  const result = allocatePurchaseFees([], { freightCost: 3, packagingCost: 2, otherCost: 1 }, "BY_AMOUNT");
  assert.deepEqual(result.lines, []);
  assert.equal(result.feeTotal, 6);
  assert.equal(result.lineAmountTotal, 0);
  assert.equal(result.actualTotal, 6);
}

console.log("v2 purchase fee allocation tests passed");
