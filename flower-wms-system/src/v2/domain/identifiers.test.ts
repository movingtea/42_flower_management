import assert from "node:assert/strict";
import {
  BATCH_NUMBER_PREFIX,
  PRODUCT_CODE_PREFIX,
  SKU_CODE_PREFIX,
  generateBatchNumber,
  generateProductCode,
  generateSkuCode,
} from "./identifiers";

const now = new Date("2026-11-06T12:34:56Z");
const entropy = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const batchNo = generateBatchNumber(now, entropy);

assert.equal(batchNo, `BATCH-20261106-${entropy}`);
assert.ok(batchNo.startsWith(`${BATCH_NUMBER_PREFIX}-`));
assert.match(batchNo, /^BATCH-\d{8}-[0-9A-Za-z-]+$/);
assert.equal(generateBatchNumber(now, entropy), batchNo);
assert.notEqual(
  generateBatchNumber(now, "entropy-one"),
  generateBatchNumber(now, "entropy-two"),
);
assert.equal(generateProductCode(now, entropy), `${PRODUCT_CODE_PREFIX}-20261106-${entropy}`);
assert.equal(generateSkuCode(now, entropy), `${SKU_CODE_PREFIX}-20261106-${entropy}`);
assert.notEqual(generateProductCode(now, "product-one"), generateProductCode(now, "product-two"));
assert.notEqual(generateSkuCode(now, "sku-one"), generateSkuCode(now, "sku-two"));

assert.throws(
  () => generateBatchNumber(new Date("invalid"), entropy),
  /date must be valid/,
);
assert.throws(() => generateBatchNumber(now, "  "), /entropy must be non-empty/);

console.log("v2 identifier tests passed");
