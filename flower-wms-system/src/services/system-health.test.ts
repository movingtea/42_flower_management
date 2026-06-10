/**
 * 运行：npm run test:system-health
 */
import assert from "node:assert/strict";
import {
  aggregateHealthStatus,
  type HealthCheckItem,
} from "@/services/system-health-pure";

function testAggregateHealth() {
  const ok: HealthCheckItem[] = [
    { key: "a", title: "A", status: "OK", message: "" },
    { key: "b", title: "B", status: "UNKNOWN", message: "" },
  ];
  assert.equal(aggregateHealthStatus(ok), "OK");

  const warn: HealthCheckItem[] = [
    ...ok,
    { key: "c", title: "C", status: "WARNING", message: "" },
  ];
  assert.equal(aggregateHealthStatus(warn), "WARNING");

  const err: HealthCheckItem[] = [
    ...warn,
    { key: "d", title: "D", status: "ERROR", message: "" },
  ];
  assert.equal(aggregateHealthStatus(err), "ERROR");
}

function run() {
  testAggregateHealth();
  console.log("system-health.test.ts: all passed");
}

run();
