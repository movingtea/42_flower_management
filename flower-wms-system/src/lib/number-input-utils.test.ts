import assert from "node:assert/strict";
import {
  formatNumberDraft,
  isValidDecimalDraft,
  isValidIntegerDraft,
  parseDecimalDraft,
  parseIntegerDraft,
} from "./number-input-utils";

function testDefaultZeroCanClear() {
  assert.equal(formatNumberDraft(0, true), "0");
  assert.equal(parseIntegerDraft(""), null);
  assert.equal(isValidIntegerDraft(""), true);
}

function testClearThenTypeEleven() {
  assert.equal(isValidIntegerDraft("1"), true);
  assert.equal(isValidIntegerDraft("11"), true);
  assert.equal(parseIntegerDraft("11"), 11);
}

function testIntegerRejectsDecimal() {
  assert.equal(parseIntegerDraft("11.5"), null);
  assert.equal(isValidDecimalDraft("12.50"), true);
  assert.equal(parseDecimalDraft("12.50"), 12.5);
}

function testNegativeIntegerDraft() {
  assert.equal(isValidIntegerDraft("-"), true);
  assert.equal(parseIntegerDraft("-3"), -3);
}

function testStockNonNegativeParse() {
  assert.equal(parseIntegerDraft("0"), 0);
  assert.equal(parseIntegerDraft("11"), 11);
}

testDefaultZeroCanClear();
testClearThenTypeEleven();
testIntegerRejectsDecimal();
testNegativeIntegerDraft();
testStockNonNegativeParse();

console.log("number-input-utils.test.ts: all passed");
