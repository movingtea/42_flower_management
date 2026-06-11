/**
 * Run: npm run test:delivery-settings
 */
import assert from "node:assert/strict";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";
import { evaluateDeliveryAvailability } from "./delivery-settings-pure";

const SHANGHAI_1659 = new Date("2026-06-10T08:59:00.000Z");
const SHANGHAI_1700 = new Date("2026-06-10T09:00:00.000Z");
const SHANGHAI_MORNING = new Date("2026-06-10T04:00:00.000Z");

function testSameDayBeforeCutoffAllowed() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-10 14:00",
    now: SHANGHAI_1659,
  });
  assert.equal(result.allowed, true);
}

function testSameDayAfterCutoffRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-10 18:00",
    now: SHANGHAI_1700,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE);
}

function testTooEarlyTimeRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11",
    deliveryTime: "09:59",
    now: SHANGHAI_MORNING,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE);
}

function testTooLateTimeRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11",
    deliveryTime: "20:01",
    now: SHANGHAI_MORNING,
  });
  assert.equal(result.allowed, false);
}

function testDisabledDateRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-12",
    now: SHANGHAI_MORNING,
    settings: { disabledDates: ["2026-06-12"] },
  });
  assert.equal(result.allowed, false);
}

function testSameDayDisabledRejected() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-10",
    now: SHANGHAI_MORNING,
    settings: { sameDayEnabled: false },
  });
  assert.equal(result.allowed, false);
}

function testTomorrowInRangeAllowed() {
  const result = evaluateDeliveryAvailability({
    deliveryDate: "2026-06-11",
    deliveryTime: "14:00",
    now: SHANGHAI_MORNING,
  });
  assert.equal(result.allowed, true);
}

function run() {
  testSameDayBeforeCutoffAllowed();
  testSameDayAfterCutoffRejected();
  testTooEarlyTimeRejected();
  testTooLateTimeRejected();
  testDisabledDateRejected();
  testSameDayDisabledRejected();
  testTomorrowInRangeAllowed();
  console.log("delivery-settings-pure.test.ts: all tests passed");
}

run();
