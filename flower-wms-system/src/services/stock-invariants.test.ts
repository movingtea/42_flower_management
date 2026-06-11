/**
 * Run: npm run test:stock-invariants
 */
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import {
  assertOrderStockAvailable,
  assertSellableSpu,
  resolveDisplayStatus,
} from "./miniprogram-stock-pure";

function testInsufficientStockThrowsCorrectCode() {
  assert.throws(
    () =>
      assertOrderStockAvailable({
        specName: "标准款",
        stock: 1,
        requestedQty: 2,
      }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK);
      return true;
    }
  );
}

function testOffShelfSeparateFromSoldOut() {
  assert.equal(
    resolveDisplayStatus({ isActive: true, isDeleted: false }, [{ stock: 0 }]),
    "SOLD_OUT"
  );
  assert.equal(
    resolveDisplayStatus({ isActive: false, isDeleted: false }, [{ stock: 10 }]),
    "OFF_SHELF"
  );
}

function testSellableSpuOffShelfCode() {
  assert.throws(
    () => assertSellableSpu({ isActive: false, isDeleted: false }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, MINIPROGRAM_ERROR_CODES.PRODUCT_OFF_SHELF);
      return true;
    }
  );
}

function testStockCannotGoNegativeInValidation() {
  assert.throws(() =>
    assertOrderStockAvailable({
      specName: "标准款",
      stock: 0,
      requestedQty: 1,
    })
  );
}

function run() {
  testInsufficientStockThrowsCorrectCode();
  testOffShelfSeparateFromSoldOut();
  testSellableSpuOffShelfCode();
  testStockCannotGoNegativeInValidation();
  console.log("stock-invariants.test.ts: all tests passed");
}

run();
