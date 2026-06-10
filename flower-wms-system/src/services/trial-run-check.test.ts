/**
 * 运行：npm run test:trial-run-check
 */
import assert from "node:assert/strict";
import {
  aggregateTrialRunStatus,
  type TrialRunStep,
} from "@/services/trial-run-check-pure";

function testAggregateTrialRunStatus() {
  const pass: TrialRunStep[] = [
    { key: "a", title: "A", status: "PASS", message: "" },
  ];
  assert.equal(aggregateTrialRunStatus(pass), "READY");

  const warn: TrialRunStep[] = [
    ...pass,
    { key: "b", title: "B", status: "WARNING", message: "" },
  ];
  assert.equal(aggregateTrialRunStatus(warn), "WARNING");

  const blocked: TrialRunStep[] = [
    ...warn,
    { key: "c", title: "C", status: "BLOCKED", message: "" },
  ];
  assert.equal(aggregateTrialRunStatus(blocked), "BLOCKED");
}

function run() {
  testAggregateTrialRunStatus();
  console.log("trial-run-check.test.ts: all passed");
}

run();
