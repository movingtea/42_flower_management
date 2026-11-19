import assert from "node:assert/strict";
import {
  EPSILON,
  assertPurchaseCapacity,
  calculatePurchaseProgress,
  nextPurchaseState,
  resolveExpectedBaseQty,
} from "./purchase-progress";

// Partial split: accepted + downgraded consume capacity but remain visibly separate.
assert.deepEqual(
  calculatePurchaseProgress(4, [
    { disposition: "ACCEPTED", quantity: 3 },
    { disposition: "DOWNGRADED", quantity: 1 },
  ]),
  {
    acceptedOriginalQty: 3,
    downgradedQty: 1,
    rejectedQty: 0,
    processedQty: 4,
    remainingQty: 0,
    state: "RECEIVED",
    hasRejection: false,
  },
);

// Rejections count toward processed quantity and are surfaced as a rejection flag.
const withRejection = calculatePurchaseProgress(10, [
  { disposition: "ACCEPTED", quantity: 5 },
  { disposition: "DOWNGRADED", quantity: 2 },
  { disposition: "REJECTED", quantity: 1 },
]);
assert.equal(withRejection.acceptedOriginalQty, 5);
assert.equal(withRejection.downgradedQty, 2);
assert.equal(withRejection.rejectedQty, 1);
assert.equal(withRejection.processedQty, 8);
assert.equal(withRejection.remainingQty, 2);
assert.equal(withRejection.state, "PARTIALLY_RECEIVED");
assert.equal(withRejection.hasRejection, true);

// Exact capacity is allowed; one more unit is not.
assert.doesNotThrow(() => assertPurchaseCapacity(10, [
  { disposition: "ACCEPTED", quantity: 6 },
  { disposition: "REJECTED", quantity: 4 },
], 0.000000001));
assert.throws(
  () => assertPurchaseCapacity(10, [
    { disposition: "ACCEPTED", quantity: 6 },
    { disposition: "REJECTED", quantity: 4 },
  ], 0.00000002),
  /累计处理数量将超过采购基础数量 10/,
);
assert.throws(
  () => assertPurchaseCapacity(10, [
    { disposition: "ACCEPTED", quantity: 6 },
    { disposition: "REJECTED", quantity: 2 },
  ], 3, "拒收"),
  /累计处理数量将超过采购基础数量 10（拒收）/,
);

// The capacity preview includes the incoming quantity in its breakdown.
assert.deepEqual(
  assertPurchaseCapacity(10, [{ disposition: "ACCEPTED", quantity: 4 }], 3, "收货", "DOWNGRADED"),
  {
    acceptedOriginalQty: 4,
    downgradedQty: 3,
    rejectedQty: 0,
    processedQty: 7,
    remainingQty: 3,
    state: "PARTIALLY_RECEIVED",
    hasRejection: false,
  },
);
assert.deepEqual(
  assertPurchaseCapacity(5, [], 5, "收货", "REJECTED"),
  {
    acceptedOriginalQty: 0,
    downgradedQty: 0,
    rejectedQty: 5,
    processedQty: 5,
    remainingQty: 0,
    state: "RECEIVED",
    hasRejection: true,
  },
);

// Invalid incoming quantity and invalid rows are rejected before any capacity decision.
for (const incoming of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => assertPurchaseCapacity(10, [], incoming),
    /本次处理数量必须为有效正数/,
  );
}
for (const row of [
  { disposition: "REJECTED", quantity: 0 },
  { disposition: "REJECTED", quantity: -1 },
  { disposition: "REJECTED", quantity: Number.NaN },
  { disposition: "REJECTED", quantity: Number.POSITIVE_INFINITY },
]) {
  assert.throws(
    () => calculatePurchaseProgress(10, [row as { disposition: "REJECTED"; quantity: number }]),
    /收货明细数量必须为有效正数/,
  );
}
assert.throws(
  () => calculatePurchaseProgress(0, []),
  /采购基础数量必须为有效正数/,
);
assert.throws(
  () => calculatePurchaseProgress(Number.NaN, []),
  /采购基础数量必须为有效正数/,
);

// State transitions, including all-rejected => RECEIVED.
assert.equal(calculatePurchaseProgress(3, []).state, "ORDERED");
assert.equal(calculatePurchaseProgress(3, [
  { disposition: "ACCEPTED", quantity: 1 },
]).state, "PARTIALLY_RECEIVED");
assert.equal(calculatePurchaseProgress(3, [
  { disposition: "REJECTED", quantity: 1 },
]).state, "PARTIALLY_RECEIVED");
const allRejected = calculatePurchaseProgress(3, [
  { disposition: "REJECTED", quantity: 3 },
]);
assert.equal(allRejected.state, "RECEIVED");
assert.equal(allRejected.remainingQty, 0);
assert.equal(allRejected.processedQty, 3);
assert.equal(allRejected.hasRejection, true);
assert.equal(nextPurchaseState(allRejected), "RECEIVED");
assert.equal(
  nextPurchaseState(calculatePurchaseProgress(3, [])),
  "ORDERED",
);
assert.equal(
  nextPurchaseState(calculatePurchaseProgress(3, [
    { disposition: "ACCEPTED", quantity: 1 },
    { disposition: "REJECTED", quantity: 1 },
  ])),
  "PARTIALLY_RECEIVED",
);

// Floating tolerance: storage noise at the epsilon boundary must not create a phantom remainder.
const toleranceRows = [
  { disposition: "ACCEPTED" as const, quantity: 0.1 },
  { disposition: "ACCEPTED" as const, quantity: 0.2 },
  { disposition: "DOWNGRADED" as const, quantity: 0.3 },
  { disposition: "REJECTED" as const, quantity: 0.4 },
];
const tolerance = calculatePurchaseProgress(1, toleranceRows);
assert.ok(tolerance.processedQty <= 1 + EPSILON);
assert.ok(tolerance.remainingQty <= EPSILON);
assert.equal(tolerance.state, "RECEIVED");
assert.doesNotThrow(() => assertPurchaseCapacity(1, toleranceRows, 0.000000001));
assert.throws(
  () => assertPurchaseCapacity(1, toleranceRows, 0.00000002),
  /累计处理数量将超过采购基础数量 1/,
);

// Expected quantity resolution: explicit value wins, same-unit fallback works, conversion fails.
assert.equal(resolveExpectedBaseQty(12, 99, "束", "支"), 12);
assert.equal(resolveExpectedBaseQty(null, 8, "支", "支"), 8);
assert.throws(
  () => resolveExpectedBaseQty(null, 8, "束", "支"),
  /采购明细缺少有效的基础单位数量/,
);
assert.throws(
  () => resolveExpectedBaseQty(0, 8, "支", "支"),
  /采购明细缺少有效的基础单位数量/,
);
assert.throws(
  () => resolveExpectedBaseQty(Number.POSITIVE_INFINITY, 8, "支", "支"),
  /采购明细缺少有效的基础单位数量/,
);
assert.throws(
  () => resolveExpectedBaseQty(null, -1, "支", "支"),
  /采购明细缺少有效的基础单位数量/,
);

console.log("v2 purchase progress tests passed");
