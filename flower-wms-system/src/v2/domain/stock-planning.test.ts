import assert from "node:assert/strict";
import { allocateBatches, assertMaterialQuantity, expandRecipe } from "./stock-planning";

const needBy = new Date("2026-12-10T10:00:00Z");

assert.deepEqual(
  expandRecipe([
    { materialId: "rose-a-red", perUnitQuantity: 5, expectedLossRate: 0.1, reservePerOrder: true, quantityScale: 0 },
    { materialId: "rose-a-red", perUnitQuantity: 1, expectedLossRate: 0, reservePerOrder: true, quantityScale: 0 },
    { materialId: "ribbon-roll", perUnitQuantity: 0, expectedLossRate: 0, reservePerOrder: false, quantityScale: 0 },
  ], 2, needBy),
  [{ materialId: "rose-a-red", quantity: 14, needBy }],
);

assert.throws(() => assertMaterialQuantity(0.5, 0), /base unit/);
assert.doesNotThrow(() => assertMaterialQuantity(0.5, 1));
assert.throws(() => expandRecipe([
  { materialId: "rose-a-red", perUnitQuantity: 1, expectedLossRate: Number.NaN, reservePerOrder: true, quantityScale: 0 },
], 1, needBy), /Expected loss rate/);

const result = allocateBatches(
  { materialId: "rose-a-red", quantity: 8, needBy },
  [
    { batchId: "later", materialId: "rose-a-red", onHand: 10, frozen: 0, orderReserved: 5, sampleReserved: 0, usableUntil: new Date("2026-12-20"), receivedAt: new Date("2026-12-01") },
    { batchId: "soon", materialId: "rose-a-red", onHand: 10, frozen: 1, orderReserved: 2, sampleReserved: 3, usableUntil: new Date("2026-12-11"), receivedAt: new Date("2026-12-02") },
    { batchId: "expired", materialId: "rose-a-red", onHand: 10, frozen: 0, orderReserved: 0, sampleReserved: 0, usableUntil: new Date("2026-12-09"), receivedAt: new Date("2026-12-01") },
    { batchId: "wrong-grade", materialId: "rose-b-red", onHand: 10, frozen: 0, orderReserved: 0, sampleReserved: 0, usableUntil: null, receivedAt: new Date("2026-12-01") },
  ],
);
assert.deepEqual(result, { allocations: [{ batchId: "soon", quantity: 4 }, { batchId: "later", quantity: 4 }], shortage: 0 });
assert.deepEqual(allocateBatches({ materialId: "rose-a-red", quantity: 9, needBy }, []), { allocations: [], shortage: 9 });

function batch(batchId: string, receivedOn: string, expiresOn: string | null, frozen = 0) {
  return {
    batchId,
    materialId: "rose-a-red",
    onHand: 1,
    frozen,
    orderReserved: 0,
    sampleReserved: 0,
    receivedAt: new Date(receivedOn),
    usableUntil: expiresOn ? new Date(expiresOn) : null,
  };
}

const mixedExpiry = allocateBatches({ materialId: "rose-a-red", quantity: 5, needBy }, [
  batch("unknown-new", "2026-12-05", null),
  batch("later-expiry", "2026-11-20", "2026-12-20"),
  batch("fully-frozen", "2026-11-21", "2026-12-11", 1),
  batch("same-expiry-new", "2026-12-05", "2026-12-12"),
  batch("unknown-old", "2026-11-18", null),
  batch("same-expiry-old", "2026-12-01", "2026-12-12"),
]);
assert.deepEqual(mixedExpiry, {
  allocations: ["same-expiry-old", "same-expiry-new", "later-expiry", "unknown-old", "unknown-new"]
    .map((batchId) => ({ batchId, quantity: 1 })),
  shortage: 0,
});

console.log("v2 stock planning tests passed");
