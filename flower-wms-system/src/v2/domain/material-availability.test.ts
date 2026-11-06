import assert from "node:assert/strict";
import { summarizeMaterialAvailability } from "./material-availability";

assert.deepEqual(summarizeMaterialAvailability([]), {
  onHandQty: 0,
  frozenQty: 0,
  orderReservedQty: 0,
  sampleReservedQty: 0,
  availableQty: 0,
});

const mixed = summarizeMaterialAvailability([
  { onHand: 10, frozen: 1, orderReserved: 2, sampleReserved: 3 },
  { onHand: 5, frozen: 0, orderReserved: 7, sampleReserved: 0 },
  { onHand: 2, frozen: 0, orderReserved: 0, sampleReserved: 0 },
]);
assert.equal(mixed.onHandQty, 17);
assert.equal(mixed.frozenQty, 1);
assert.equal(mixed.orderReservedQty, 9);
assert.equal(mixed.sampleReservedQty, 3);
// Batch 1: 4, batch 2: 0 (clamped), batch 3: 2.
assert.equal(mixed.availableQty, 6);

assert.throws(
  () => summarizeMaterialAvailability([{ onHand: 1, frozen: -1, orderReserved: 0, sampleReserved: 0 }]),
  /nonnegative/,
);
assert.throws(
  () => summarizeMaterialAvailability([{ onHand: Number.NaN, frozen: 0, orderReserved: 0, sampleReserved: 0 }]),
  /finite/,
);

console.log("v2 material availability tests passed");
