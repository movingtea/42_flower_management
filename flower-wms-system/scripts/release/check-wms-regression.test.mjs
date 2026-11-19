/**
 * Direct-run tests for check-wms-regression.mjs.
 *
 * Run with plain Node (no node --test, no tsx/vitest):
 *   node scripts/release/check-wms-regression.test.mjs
 *
 * The DSH workspace sandbox blocks piped child processes, so this file uses
 * only in-process assertions and never spawns anything.
 */

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_REQUIRED_IDS,
  exitCodeFor,
  renderChecklist,
  validateRegressionData,
} from "./check-wms-regression.mjs";
import {
  REGRESSION_ITEMS,
  REQUIRED_IDS,
  STATUSES,
} from "./wms-regression-data.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const APP_ROOT = resolve(REPO_ROOT, "flower-wms-system");
const TEST_REQUIRED_IDS = ["A01", "A02"];
const VALIDATION_OPTIONS = {
  repoRoot: REPO_ROOT,
  appRoot: APP_ROOT,
  requiredIds: TEST_REQUIRED_IDS,
};

let passed = 0;

function test(name, callback) {
  try {
    callback();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    throw error;
  }
}

function makeItem(overrides = {}) {
  return {
    id: "A01",
    area: "A",
    title: "员工登录",
    v1Capability: "员工账号密码登录、退出。",
    v2Entry: "/v2",
    entryNote: "",
    evidence: ["flower-wms-system/tests/e2e/smoke.spec.ts"],
    status: "verified",
    reason: "",
    impact: "",
    signoff: "Lead",
    notes: "",
    ...overrides,
  };
}

function validate(items, overrides = {}) {
  return validateRegressionData(items, {
    ...VALIDATION_OPTIONS,
    ...overrides,
  });
}

function errorCodes(result) {
  return result.errors.map((error) => error.code);
}

const validItems = [
  makeItem(),
  makeItem({
    id: "A02",
    v2Entry: "/v2/orders",
    evidence: ["flower-wms-system/src/app/v2/orders/page.tsx"],
  }),
];

test("valid fixture set is accepted", () => {
  const result = validate(validItems);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.byStatus.verified, 2);
  assert.equal(result.summary.byArea.A.total, 2);
});

test("dynamic [id] v2Entry resolves to a real page", () => {
  const result = validateRegressionData(
    [
      makeItem({
        id: "B06",
        area: "B",
        v2Entry: "/v2/inventory/[id]",
        evidence: ["flower-wms-system/src/app/v2/inventory/[id]/page.tsx"],
      }),
    ],
    {
      repoRoot: REPO_ROOT,
      appRoot: APP_ROOT,
      requiredIds: ["B06"],
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
});

test("missing required ID is rejected", () => {
  const result = validate([validItems[0]]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("MISSING_REQUIRED_ID"));
  assert.equal(
    result.errors.find((error) => error.code === "MISSING_REQUIRED_ID").id,
    "A02",
  );
});

test("duplicate ID is rejected", () => {
  const result = validate([makeItem(), makeItem()]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("DUPLICATE_ID"));
});

test("extra ID outside the required scope is rejected", () => {
  const result = validate([validItems[0], validItems[1]], {
    requiredIds: ["A01"],
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("UNKNOWN_ID"));
});

test("invalid status is rejected", () => {
  const result = validate([
    makeItem({ status: "done" }),
    validItems[1],
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("INVALID_STATUS"));
});

test("unexplained blocked item is rejected", () => {
  const result = validate([
    validItems[0],
    makeItem({
      id: "A02",
      v2Entry: "/v2/orders",
      evidence: ["flower-wms-system/src/app/v2/orders/page.tsx"],
      status: "blocked",
      reason: "",
      impact: "",
      signoff: "",
    }),
  ]);
  assert.equal(result.ok, false);
  const codes = errorCodes(result);
  assert.ok(codes.includes("MISSING_REASON"));
  assert.ok(codes.includes("MISSING_IMPACT"));
  assert.ok(codes.includes("MISSING_SIGNOFF"));
  assert.equal(result.warnings.find((item) => item.id === "A02").status, "blocked");
});

test("partial item without signoff is rejected", () => {
  const result = validate([
    validItems[0],
    makeItem({
      id: "A02",
      v2Entry: "/v2/orders",
      evidence: ["flower-wms-system/src/app/v2/orders/page.tsx"],
      status: "partial",
      reason: "some branches are not covered",
      impact: "cannot claim full coverage",
      signoff: "",
    }),
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("MISSING_SIGNOFF"));
});

test("stale evidence path is rejected", () => {
  const result = validate([
    validItems[0],
    makeItem({
      id: "A02",
      v2Entry: "/v2/orders",
      evidence: ["flower-wms-system/src/app/v2/orders/does-not-exist.tsx"],
    }),
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("EVIDENCE_NOT_FOUND"));
});

test("absolute or parent-escaping evidence is rejected", () => {
  const result = validate([
    makeItem({ evidence: ["D:/outside/file.ts"] }),
    validItems[1],
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("INVALID_EVIDENCE_PATH"));
});

test("duplicate evidence within one item is rejected", () => {
  const result = validate([
    makeItem({
      evidence: [
        "flower-wms-system/tests/e2e/smoke.spec.ts",
        "flower-wms-system/tests/e2e/smoke.spec.ts",
      ],
    }),
    validItems[1],
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("DUPLICATE_EVIDENCE"));
});

test("empty title is rejected", () => {
  const result = validate([makeItem({ title: "   " }), validItems[1]]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("MISSING_TITLE"));
});

test("verified item with an open reason is rejected", () => {
  const result = validate([makeItem({ reason: "still open" }), validItems[1]]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("UNEXPECTED_REASON"));
});

test("area prefix mismatch is rejected", () => {
  const result = validate([validItems[0], makeItem({ id: "A02", area: "B" })]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("AREA_MISMATCH"));
});

test("v2Entry outside /v2 is rejected", () => {
  const result = validate([validItems[0], makeItem({ id: "A02", v2Entry: "/wms/orders" })]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("INVALID_V2_ENTRY"));
});

test("v2Entry without a real page.tsx is rejected", () => {
  const result = validate([
    validItems[0],
    makeItem({ id: "A02", v2Entry: "/v2/not-a-real-page" }),
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("V2_ENTRY_NOT_FOUND"));
});

test("not_applicable without a documented reason is rejected", () => {
  const result = validate([
    makeItem({ status: "not_applicable", reason: "", signoff: "Lead" }),
    validItems[1],
  ]);
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).includes("MISSING_REASON"));
});

test("real repository inventory has all 56 canonical IDs and known counts", () => {
  assert.equal(CANONICAL_REQUIRED_IDS.length, 56);
  const result = validateRegressionData(REGRESSION_ITEMS, {
    requiredIds: CANONICAL_REQUIRED_IDS,
    declaredRequiredIds: REQUIRED_IDS,
    declaredStatuses: STATUSES,
    repoRoot: REPO_ROOT,
    appRoot: APP_ROOT,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.summary.total, 56);
  assert.deepEqual(result.summary.byStatus, {
    verified: 42,
    partial: 14,
    blocked: 0,
    not_applicable: 0,
  });
  assert.equal(exitCodeFor(result), 0);
  assert.equal(exitCodeFor(result, { failOnBlocked: true }), 0);
});

test("checklist renderer emits 56 rows, the gate command and the non-verified section", () => {
  const markdown = renderChecklist(REGRESSION_ITEMS, {
    date: "2026-11-19",
    requiredIds: CANONICAL_REQUIRED_IDS,
  });
  assert.match(markdown, /^# Sprint 3 第一阶段 WMS 回归清单/m);
  assert.match(markdown, /b4d93d8/);
  assert.match(markdown, /--fail-on-blocked/);
  assert.match(markdown, /## 阻断\/部分覆盖项/);
  assert.equal((markdown.match(/^\| [A-H][0-9]{2} \|/gm) || []).length, 56);
  assert.doesNotMatch(markdown, /### 阻断（/);
  assert.match(markdown, /### 部分覆盖（14）/);
});

console.log(`\n${passed} checks passed`);
