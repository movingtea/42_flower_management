import assert from "node:assert/strict";
import {
  baseQuantityStep,
  isEligiblePurchaseLine,
  isLatePurchaseLine,
  outstandingAllocatableQty,
  purchaseLineAllocationLabel,
  roundQuantity,
  shortageAllocationState,
  sortReplacementMaterialOptions,
  suggestedAllocationQuantity,
  summarizeShortageQuantities,
  sumQuantities,
  toPurchaseReceiptRows,
} from "./purchase-ui";

const needBy = new Date("2026-12-10T10:00:00Z");

assert.deepEqual(
  toPurchaseReceiptRows([
    { disposition: "ACCEPTED", quantity: "3.000" },
    { disposition: "REJECTED", quantity: 2 },
  ]),
  [
    { disposition: "ACCEPTED", quantity: 3 },
    { disposition: "REJECTED", quantity: 2 },
  ],
);
assert.throws(
  () => toPurchaseReceiptRows([{ disposition: "UNKNOWN", quantity: 1 }]),
  /未知验收处置类型/,
);

// Every processed disposition and every allocation consume the line's allocatable quantity.
assert.equal(outstandingAllocatableQty(10, 6, 2), 2);
assert.equal(outstandingAllocatableQty(10, 10, 0), 0);
assert.equal(outstandingAllocatableQty(10, 12, 0), 0);

const requirement = { materialId: "material-a", needBy };
assert.equal(isEligiblePurchaseLine({
  materialId: "material-a",
  expectedAt: new Date("2026-12-09T10:00:00Z"),
  allocatableQty: 2,
}, requirement), true);
assert.equal(isEligiblePurchaseLine({
  materialId: "material-a",
  expectedAt: null,
  allocatableQty: 2,
}, requirement), true);
assert.equal(isEligiblePurchaseLine({
  materialId: "material-b",
  expectedAt: null,
  allocatableQty: 2,
}, requirement), false);
assert.equal(isEligiblePurchaseLine({
  materialId: "material-a",
  expectedAt: null,
  allocatableQty: 0,
}, requirement), false);
assert.equal(isEligiblePurchaseLine({
  materialId: "material-a",
  expectedAt: new Date("2026-12-11T10:00:00Z"),
  allocatableQty: 2,
}, requirement), false);
assert.equal(isLatePurchaseLine({
  materialId: "material-a",
  expectedAt: new Date("2026-12-11T10:00:00Z"),
  allocatableQty: 2,
}, requirement), true);

const sorted = sortReplacementMaterialOptions([
  { material: { code: "B", name: "B" }, availableQty: 1 },
  { material: { code: "A", name: "A" }, availableQty: 10 },
  { material: { code: "C", name: "C" }, availableQty: 3 },
], 5);
assert.deepEqual(sorted.map((option) => option.material.code), ["A", "C", "B"]);

// Decimal-like requirement amounts are rounded to base-unit precision before comparisons.
assert.equal(roundQuantity("2.0004"), 2);
assert.equal(roundQuantity("2.0005"), 2.001);
assert.equal(roundQuantity(undefined), 0);
assert.equal(baseQuantityStep(0), 1);
assert.equal(baseQuantityStep(1), 0.1);
assert.equal(baseQuantityStep(3), 0.001);
assert.equal(baseQuantityStep(-1), 1);
assert.equal(sumQuantities(["1.005", 2, "0.001", Number.NaN]), 3.006);
assert.deepEqual(
  summarizeShortageQuantities({
    plannedQty: "10.000",
    reservedQtys: ["2.000", 1],
    allocatedQtys: ["2.500"],
  }),
  {
    plannedQty: 10,
    reservedQty: 3,
    allocatedQty: 2.5,
    currentShortage: 7,
    pendingAssociationQty: 4.5,
  },
);
// Boundary: fully allocated and over-allocated shortages both report no pending quantity.
assert.equal(summarizeShortageQuantities({
  plannedQty: 5,
  reservedQtys: [0],
  allocatedQtys: [5],
}).pendingAssociationQty, 0);
assert.equal(summarizeShortageQuantities({
  plannedQty: 5,
  reservedQtys: [0],
  allocatedQtys: [6],
}).pendingAssociationQty, 0);
assert.equal(summarizeShortageQuantities({
  plannedQty: 5,
  reservedQtys: [6],
  allocatedQtys: [],
}).pendingAssociationQty, 0);

assert.equal(suggestedAllocationQuantity(4.5, 10), 4.5);
assert.equal(suggestedAllocationQuantity(4.5, 2), 2);
assert.equal(suggestedAllocationQuantity(0, 10), 0);
assert.equal(suggestedAllocationQuantity(4.5, 0), 0);
assert.equal(suggestedAllocationQuantity(-1, -1), 0);
assert.equal(suggestedAllocationQuantity("2.0004", "9"), 2);

assert.equal(shortageAllocationState({
  sameMaterialLineCount: 2, availableLineCount: 1, lateLineCount: 1,
}), "AVAILABLE");
assert.equal(shortageAllocationState({
  sameMaterialLineCount: 2, availableLineCount: 0, lateLineCount: 1,
}), "LATE_LINE");
assert.equal(shortageAllocationState({
  sameMaterialLineCount: 2, availableLineCount: 0, lateLineCount: 0,
}), "FULLY_ALLOCATED");
assert.equal(shortageAllocationState({
  sameMaterialLineCount: 0, availableLineCount: 0, lateLineCount: 0,
}), "NO_LINE");

const allocationLabel = purchaseLineAllocationLabel({
  purchaseOrderNumber: "PO-001",
  materialCode: "MAT-01",
  materialName: "玫瑰",
  allocatableQty: "3.500",
  baseUnit: "支",
  expectedAt: new Date("2026-12-09T10:00:00Z"),
});
assert.match(allocationLabel, /^PO-001 · MAT-01 玫瑰 · 可分配 3\.5支 · 预计到货 /);
assert.equal(purchaseLineAllocationLabel({
  purchaseOrderNumber: "PO-002",
  materialCode: "MAT-02",
  materialName: "百合",
  allocatableQty: 1,
  baseUnit: "支",
  expectedAt: null,
}).endsWith("预计到货 未设置"), true);

console.log("v2 purchase UI helper tests passed");
