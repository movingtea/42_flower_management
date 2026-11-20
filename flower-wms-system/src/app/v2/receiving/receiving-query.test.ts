/**
 * Run with:
 *   npx tsx src/app/v2/receiving/receiving-query.test.ts
 */
import assert from "node:assert/strict";
import {
  RECEIVING_EPSILON,
  isReceivingLineActionable,
  isReceivingLineOverdue,
  normalizeReceivingState,
  receivingLineStatus,
  summarizeReceivingLines,
} from "./receiving-query";

const NOW = new Date("2026-11-20T12:00:00+08:00");

function testNormalizeState() {
  assert.equal(normalizeReceivingState(undefined), "open");
  assert.equal(normalizeReceivingState(""), "open");
  assert.equal(normalizeReceivingState(["open"]), "open");
  assert.equal(normalizeReceivingState("PARTIALLY_RECEIVED"), "PARTIALLY_RECEIVED");
  assert.equal(normalizeReceivingState("all"), "all");
  // Unknown values never become a Prisma filter; they fall back to the safe default.
  assert.equal(normalizeReceivingState("RECEIVING"), "open");
  assert.equal(normalizeReceivingState("order"), "open");
}

function testActionable() {
  assert.equal(isReceivingLineActionable(0), false);
  assert.equal(isReceivingLineActionable(RECEIVING_EPSILON), false);
  assert.equal(isReceivingLineActionable(0.001), true);
  assert.equal(isReceivingLineActionable("2"), true);
  assert.equal(isReceivingLineActionable(Number.NaN), false);
  assert.equal(isReceivingLineActionable(undefined), false);
}

function testOverdue() {
  assert.equal(isReceivingLineOverdue(new Date("2026-11-20T11:59:00+08:00"), 2, NOW), true);
  assert.equal(isReceivingLineOverdue(new Date("2026-11-20T12:01:00+08:00"), 2, NOW), false);
  // A fully processed line is not an overdue receiving task.
  assert.equal(isReceivingLineOverdue(new Date("2026-11-20T09:00:00+08:00"), 0, NOW), false);
  assert.equal(isReceivingLineOverdue(null, 2, NOW), false);
}

function testSummary() {
  const lines = [
    {
      purchaseOrderNumber: "PO-1",
      expectedAt: new Date("2026-11-20T09:00:00+08:00"),
      expectedBaseQty: 10,
      processedQty: 4,
      remainingQty: 6,
    },
    {
      purchaseOrderNumber: "PO-1",
      expectedAt: new Date("2026-11-21T09:00:00+08:00"),
      expectedBaseQty: 5,
      processedQty: 0,
      remainingQty: 5,
    },
    {
      purchaseOrderNumber: "PO-2",
      expectedAt: new Date("2026-11-19T09:00:00+08:00"),
      expectedBaseQty: 3,
      processedQty: 3,
      remainingQty: 0,
    },
  ];
  assert.deepEqual(summarizeReceivingLines(lines, NOW), {
    orderCount: 2,
    lineCount: 3,
    actionableLineCount: 2,
    pendingQty: 11,
    overdueLineCount: 1,
  });
  assert.deepEqual(summarizeReceivingLines([], NOW), {
    orderCount: 0,
    lineCount: 0,
    actionableLineCount: 0,
    pendingQty: 0,
    overdueLineCount: 0,
  });
}

function testLineStatus() {
  assert.deepEqual(receivingLineStatus({ processedQty: 0, remainingQty: 4 }), {
    label: "待验收",
    tone: "neutral",
  });
  assert.deepEqual(receivingLineStatus({ processedQty: 4, remainingQty: 6 }), {
    label: "部分验收",
    tone: "warning",
  });
  assert.deepEqual(receivingLineStatus({ processedQty: 10, remainingQty: 0 }), {
    label: "已全部处理",
    tone: "success",
  });
}

function run(): void {
  testNormalizeState();
  testActionable();
  testOverdue();
  testSummary();
  testLineStatus();
  console.log("receiving query tests passed");
}

run();
