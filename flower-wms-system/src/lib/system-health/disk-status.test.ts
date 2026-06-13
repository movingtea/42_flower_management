/**
 * Run: npm run test:disk-status
 */
import assert from "node:assert/strict";
import {
  diskStatusToHealthCheckStatus,
  getDiskStatusFromPercent,
} from "@/lib/system-health/disk-status";

function testOk() {
  assert.equal(getDiskStatusFromPercent(50), "OK");
  assert.equal(getDiskStatusFromPercent(79), "OK");
  assert.equal(diskStatusToHealthCheckStatus("OK"), "OK");
}

function testWarning() {
  assert.equal(getDiskStatusFromPercent(80), "WARNING");
  assert.equal(getDiskStatusFromPercent(89), "WARNING");
  assert.equal(diskStatusToHealthCheckStatus("WARNING"), "WARNING");
}

function testCritical() {
  assert.equal(getDiskStatusFromPercent(90), "CRITICAL");
  assert.equal(getDiskStatusFromPercent(99), "CRITICAL");
  assert.equal(diskStatusToHealthCheckStatus("CRITICAL"), "ERROR");
}

function testUnknown() {
  assert.equal(getDiskStatusFromPercent(null), "UNKNOWN");
  assert.equal(getDiskStatusFromPercent(undefined), "UNKNOWN");
  assert.equal(getDiskStatusFromPercent(NaN), "UNKNOWN");
  assert.equal(getDiskStatusFromPercent(-1), "UNKNOWN");
  assert.equal(getDiskStatusFromPercent(101), "UNKNOWN");
}

function run() {
  testOk();
  testWarning();
  testCritical();
  testUnknown();
  console.log("disk-status.test.ts: all tests passed");
}

run();
