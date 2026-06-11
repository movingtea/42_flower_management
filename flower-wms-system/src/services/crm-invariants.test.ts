/**
 * Run: npm run test:crm-invariants
 */
import assert from "node:assert/strict";
import {
  isSystemReminderExpired,
  SYSTEM_REMINDER_EXPIRY_MS,
} from "./crm-pure";

function testReminderExpiredAfterOneDay() {
  const createdAt = new Date(Date.now() - SYSTEM_REMINDER_EXPIRY_MS - 1000);
  assert.equal(isSystemReminderExpired({ createdAt, status: "PENDING" }), true);
}

function testReminderNotExpiredWithinOneDay() {
  const createdAt = new Date(Date.now() - 60 * 60 * 1000);
  assert.equal(isSystemReminderExpired({ createdAt, status: "PENDING" }), false);
}

function testCompletedReminderNotExpired() {
  const createdAt = new Date(Date.now() - SYSTEM_REMINDER_EXPIRY_MS * 2);
  assert.equal(
    isSystemReminderExpired({ createdAt, status: "COMPLETED" }),
    false
  );
}

function run() {
  testReminderExpiredAfterOneDay();
  testReminderNotExpiredWithinOneDay();
  testCompletedReminderNotExpired();
  console.log("crm-invariants.test.ts: all tests passed");
}

run();
