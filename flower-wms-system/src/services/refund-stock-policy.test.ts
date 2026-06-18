/**
 * 退款库存策略（Batch B.1）
 * Run: npm run test:refund-stock-policy
 */
import assert from "node:assert/strict";
import { OrderStatus } from "@/generated/prisma/enums";
import {
  paidOrderFulfillmentInvariant,
  paidRefundStockPolicy,
  pendingCancelStockInvariant,
} from "./order-invariants-pure";

function testRefundRollbackFalse() {
  const policy = paidRefundStockPolicy(false);
  assert.equal(policy.restoreProductSkuStock, false);
  assert.equal(policy.incrementBatchRemainingQty, false);
  assert.equal(policy.createInCancel, false);
  assert.equal(policy.preserveSaleOut, true);
  assert.equal(policy.preserveOrderCostSnapshot, true);
}

function testRefundRollbackTrueVirtualOnly() {
  const policy = paidRefundStockPolicy(true);
  assert.equal(policy.restoreProductSkuStock, true);
  assert.equal(policy.incrementBatchRemainingQty, false);
  assert.equal(policy.createInCancel, false);
  assert.equal(policy.preserveSaleOut, true);
}

function testPendingCloseUnchanged() {
  const inv = pendingCancelStockInvariant();
  assert.equal(inv.restoreProductSkuStock, true);
  assert.equal(inv.decrementBatchRemainingQty, false);
  assert.equal(inv.createSaleOut, false);
}

function testPaidFifoUnchanged() {
  const paid = paidOrderFulfillmentInvariant(OrderStatus.PAID);
  assert.equal(paid.shouldDecrementBatch, true);
  assert.equal(paid.shouldCreateSaleOut, true);
  assert.equal(paid.shouldCreateCostSnapshot, true);
}

function testRefundDoesNotImplyPhysicalRestore() {
  for (const rollbackStock of [true, false]) {
    const policy = paidRefundStockPolicy(rollbackStock);
    assert.equal(
      policy.incrementBatchRemainingQty,
      false,
      `rollbackStock=${rollbackStock} must not restore physical batch`
    );
    assert.equal(
      policy.createInCancel,
      false,
      `rollbackStock=${rollbackStock} must not write IN_CANCEL`
    );
  }
}

function run() {
  testRefundRollbackFalse();
  testRefundRollbackTrueVirtualOnly();
  testPendingCloseUnchanged();
  testPaidFifoUnchanged();
  testRefundDoesNotImplyPhysicalRestore();
  console.log("refund-stock-policy.test.ts: all tests passed");
}

run();
