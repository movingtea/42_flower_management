import assert from "node:assert/strict";
import { summarizeBatchStock } from "./inventory-summary";

assert.deepEqual(summarizeBatchStock([
  { onHandQty: 10, frozenQty: 2, reservedQty: 3 },
  { onHandQty: 4, frozenQty: 0, reservedQty: 1 },
]), { onHandQty: 14, frozenQty: 2, reservedQty: 4, availableQty: 8 });
assert.deepEqual(summarizeBatchStock([{ onHandQty: 2, frozenQty: 3, reservedQty: 4 }]), { onHandQty: 2, frozenQty: 3, reservedQty: 4, availableQty: 0 });
console.log("v2 inventory summary tests passed");
