/**
 * Run: npm run test:order-invariants
 */
import assert from "node:assert/strict";
import { OrderStatus } from "@/generated/prisma/enums";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import {
  assertSoldOutNotOffShelf,
  assertStockErrorCode,
  assertStockFailureDoesNotChangeShelfState,
  isPendingPaymentExpired,
  paidOrderFulfillmentInvariant,
  paidRefundStockInvariant,
  pendingCancelStockInvariant,
  PENDING_PAYMENT_TIMEOUT_MS,
} from "./order-invariants-pure";

function testStockFailureDoesNotChangeShelf() {
  assert.equal(
    assertStockFailureDoesNotChangeShelfState({
      before: { isActive: true, isDeleted: false },
      after: { isActive: true, isDeleted: false },
    }),
    null
  );
  assert.ok(
    assertStockFailureDoesNotChangeShelfState({
      before: { isActive: true, isDeleted: false },
      after: { isActive: false, isDeleted: false },
    })
  );
}

function testSoldOutNotOffShelf() {
  assert.equal(
    assertSoldOutNotOffShelf(
      { isActive: true, isDeleted: false },
      [{ stock: 0 }]
    ),
    null
  );
}

function testStockErrorCodeMapping() {
  assert.equal(
    assertStockErrorCode(MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK, {
      isActive: true,
      isDeleted: false,
    }),
    null
  );
  assert.ok(
    assertStockErrorCode(MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF, {
      isActive: true,
      isDeleted: false,
    })
  );
}

function testPendingCancelInvariant() {
  const inv = pendingCancelStockInvariant();
  assert.equal(inv.restoreProductSkuStock, true);
  assert.equal(inv.decrementBatchRemainingQty, false);
  assert.equal(inv.createSaleOut, false);
  assert.equal(inv.createOrderCostSnapshot, false);
}

function testPaidRefundDefaultNoRollback() {
  const inv = paidRefundStockInvariant(false);
  assert.equal(inv.defaultRollbackStock, false);
  assert.equal(inv.rollbackStockWhenExplicit, false);
}

function testPaidFulfillmentInvariant() {
  const pending = paidOrderFulfillmentInvariant(OrderStatus.PENDING_PAYMENT);
  assert.equal(pending.shouldDecrementBatch, false);
  const paid = paidOrderFulfillmentInvariant(OrderStatus.PAID);
  assert.equal(paid.shouldCreateSaleOut, true);
  assert.equal(paid.shouldCreateCostSnapshot, true);
}

function testPendingPaymentExpiry() {
  const createdAt = new Date(Date.now() - PENDING_PAYMENT_TIMEOUT_MS - 1000);
  assert.equal(isPendingPaymentExpired(createdAt), true);
  assert.equal(isPendingPaymentExpired(new Date()), false);
}

function run() {
  testStockFailureDoesNotChangeShelf();
  testSoldOutNotOffShelf();
  testStockErrorCodeMapping();
  testPendingCancelInvariant();
  testPaidRefundDefaultNoRollback();
  testPaidFulfillmentInvariant();
  testPendingPaymentExpiry();
  console.log("order-flow-invariants.test.ts: all tests passed");
}

run();
