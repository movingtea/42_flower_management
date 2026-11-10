import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODES,
  RunnerError,
  assertFilesFound,
  discoverMode,
  main,
  parseArgs,
  validateManagedDbEnv,
} from "./test-v2.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE_PATTERN = /\.test\.ts$/;

// Baseline only: new valid tests may extend discovery without breaking these
// checks. The filesystem-derived expectations below verify the exact current
// discovery result, including sorting, uniqueness and DB-free classification.
const BASELINE_UNIT_FILES = [
  "src/app/v2/_lib/purchase-ui.test.ts",
  "src/app/v2/order-ui.test.ts",
  "src/v2/domain/identifiers.test.ts",
  "src/v2/domain/inventory-summary.test.ts",
  "src/v2/domain/material-availability.test.ts",
  "src/v2/domain/purchase-progress.test.ts",
  "src/v2/domain/stock-planning.test.ts",
  "src/v2/navigation.test.ts",
];

const BASELINE_INTEGRATION_EXTRA_FILES = [
  "src/v2/auth-source.test.ts",
  "src/v2/services/adjust-final-cost.test.ts",
  "src/v2/services/allocate-purchase-demand.test.ts",
  "src/v2/services/catalog-management.test.ts",
  "src/v2/services/complete-delivery.test.ts",
  "src/v2/services/complete-production-actual.test.ts",
  "src/v2/services/delivery-management.test.ts",
  "src/v2/services/inventory-operations.test.ts",
  "src/v2/services/loss-management.test.ts",
  "src/v2/services/manual-order-multi.test.ts",
  "src/v2/services/order-cost-management.test.ts",
  "src/v2/services/order-lifecycle.test.ts",
  "src/v2/services/packaging-kit.test.ts",
  "src/v2/services/purchase-order-management.test.ts",
  "src/v2/services/receive-purchase-line.test.ts",
  "src/v2/services/recipe-management.test.ts",
  "src/v2/services/record-manual-payment.test.ts",
  "src/v2/services/record-refund.test.ts",
  "src/v2/services/reject-purchase-line.test.ts",
  "src/v2/services/revise-order.test.ts",
  "src/v2/services/staff-management.test.ts",
  "src/v2/services/stocktake.test.ts",
  "src/v2/services/substitute-order-material.test.ts",
];

const BASELINE_INTEGRATION_FILES = [
  ...BASELINE_UNIT_FILES,
  ...BASELINE_INTEGRATION_EXTRA_FILES,
].sort();

const BASELINE_SMOKE_FILES = [
  "scripts/v2/smoke-core-flow.ts",
  "scripts/v2/smoke-purchase-receipt.ts",
  "scripts/v2/smoke-reservation.ts",
  "scripts/v2/smoke-shortage-recovery.ts",
];

// This classifier is deliberately re-implemented here instead of importing the
// runner helper: the assertion is that discovery agrees with an independent
// reading of the test sources. A DB-free test imports only pure modules; any
// Prisma, generated client, server-only or DB service import excludes it.
// Only import specifiers are inspected: fixture strings that mention a service
// module do not make a pure UI test database-backed.
const DATABASE_MODULE_PATTERNS = [
  /^@prisma\/(client|adapter-pg)$/,
  /^@\/lib\/prisma(\/|$)/,
  /^@\/lib\/tenant\//,
  /^@\/v2\/services\//,
  /(^|\/)generated\/prisma([-/]|$)/,
  /^server-only$/,
];

function importSpecifiers(source) {
  const specifiers = [];
  const importPattern = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(source)) !== null) specifiers.push(match[1]);
  const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requirePattern.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

function isDatabaseFreeSource(source) {
  return !importSpecifiers(source).some((specifier) =>
    DATABASE_MODULE_PATTERNS.some((pattern) => pattern.test(specifier)),
  );
}

function collectExpectedFiles(root, relativeDirectory, accept) {
  const files = [];
  for (const entry of readdirSync(resolve(root, relativeDirectory), { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectExpectedFiles(root, relativePath, accept));
    } else if (entry.isFile() && accept(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

function collectExpectedFlatFiles(root, relativeDirectory, accept) {
  return readdirSync(resolve(root, relativeDirectory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && accept(entry.name))
    .map((entry) => `${relativeDirectory}/${entry.name}`);
}

function sortedUnique(files) {
  return [...new Set(files)].sort();
}

function isDatabaseFreeFile(root, relativePath) {
  return isDatabaseFreeSource(readFileSync(resolve(root, relativePath), "utf8"));
}

function expectedUnitFiles(root) {
  const candidates = [
    ...collectExpectedFiles(root, "src/v2/domain", (name) => TEST_FILE_PATTERN.test(name)),
    "src/v2/navigation.test.ts",
    ...collectExpectedFiles(root, "src/app/v2", (name) => TEST_FILE_PATTERN.test(name)),
  ];
  return sortedUnique(candidates.filter((file) => isDatabaseFreeFile(root, file)));
}

function expectedIntegrationFiles(root) {
  return sortedUnique([
    ...collectExpectedFiles(root, "src/v2", (name) => TEST_FILE_PATTERN.test(name)),
    ...collectExpectedFiles(root, "src/app/v2", (name) => TEST_FILE_PATTERN.test(name)),
  ]);
}

function expectedSmokeFiles(root) {
  return sortedUnique(
    collectExpectedFlatFiles(
      root,
      "scripts/v2",
      (name) => name.startsWith("smoke-") && name.endsWith(".ts"),
    ),
  );
}

function writeFixtureFile(root, relativePath, content) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

const VALID_DATABASE = "wms_0123456789abcdef_test";
const VALID_URL = `postgresql://tester@127.0.0.1:55432/${VALID_DATABASE}`;
const VALID_ENV = { WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL };

function assertUsageError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof RunnerError, "expected RunnerError");
    assert.equal(error.exitCode, 2, "expected usage/config exit code");
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("parseArgs accepts the documented modes and --list", () => {
  assert.deepEqual(parseArgs(["unit"]), { mode: "unit", list: false });
  assert.deepEqual(parseArgs(["integration", "--list"]), { mode: "integration", list: true });
  assert.deepEqual(parseArgs(["--list", "smoke"]), { mode: "smoke", list: true });
});

test("modes are the documented three", () => {
  assert.deepEqual([...MODES], ["unit", "integration", "smoke"]);
});

test("parseArgs rejects missing, unknown and duplicate arguments", () => {
  for (const argv of [
    [],
    ["--list"],
    ["unit", "integration"],
    ["unit", "--bogus"],
    ["--bogus", "unit"],
    ["fast"],
    ["UNIT"],
  ]) {
    assertUsageError(() => parseArgs(argv));
  }
});

test("unit discovery matches independent DB-free classification", async () => {
  const files = await discoverMode("unit");
  assert.deepEqual(files, expectedUnitFiles(PROJECT_ROOT));
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const required of BASELINE_UNIT_FILES) {
    assert.ok(files.includes(required), `missing baseline unit file: ${required}`);
  }
  for (const file of files) {
    assert.equal(
      isDatabaseFreeFile(PROJECT_ROOT, file),
      true,
      `unit file imports a database or server module: ${file}`,
    );
  }
  assert.equal(files.some((file) => file.includes("/services/")), false);
});

test("integration discovery matches an independent walk of every V2 test", async () => {
  const files = await discoverMode("integration");
  const expected = expectedIntegrationFiles(PROJECT_ROOT);
  assert.deepEqual(files, expected);
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const required of BASELINE_INTEGRATION_FILES) {
    assert.ok(files.includes(required), `missing baseline integration file: ${required}`);
  }
  for (const unitFile of await discoverMode("unit")) {
    assert.ok(files.includes(unitFile), `unit file missing from integration: ${unitFile}`);
  }
  assert.ok(files.every((file) => file.startsWith("src/")));
});

test("smoke discovery covers every scripts/v2 smoke script", async () => {
  const files = await discoverMode("smoke");
  assert.deepEqual(files, expectedSmokeFiles(PROJECT_ROOT));
  assert.deepEqual(files, [...files].sort());
  assert.equal(new Set(files).size, files.length);
  for (const required of BASELINE_SMOKE_FILES) {
    assert.ok(files.includes(required), `missing baseline smoke script: ${required}`);
  }
});

test("zero discovered files fail", () => {
  assert.throws(
    () => assertFilesFound([], "integration"),
    (error) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.exitCode, 1);
      assert.match(error.message, /No integration test files matched/);
      return true;
    },
  );
  assert.deepEqual(assertFilesFound(["src/v2/navigation.test.ts"], "unit"), [
    "src/v2/navigation.test.ts",
  ]);
});

test("unknown discovery mode fails", async () => {
  await assert.rejects(discoverMode("fast"), (error) => {
    assert.ok(error instanceof RunnerError);
    assert.equal(error.exitCode, 2);
    return true;
  });
});

test("a new compliant test file is discovered without changing the self-check", async () => {
  const root = mkdtempSync(join(tmpdir(), "wms-v2-discovery-"));
  try {
    writeFixtureFile(root, "src/v2/domain/pure.test.ts", 'import assert from "node:assert/strict";\n');
    writeFixtureFile(
      root,
      "src/v2/domain/db-backed.test.ts",
      'import { prisma } from "@/lib/prisma";\n',
    );
    writeFixtureFile(root, "src/v2/navigation.test.ts", 'import assert from "node:assert/strict";\n');
    writeFixtureFile(
      root,
      "src/v2/services/order.test.ts",
      'import { createOrder } from "./order";\n',
    );
    writeFixtureFile(root, "src/app/v2/_lib/helper.test.ts", 'import assert from "node:assert/strict";\n');
    writeFixtureFile(
      root,
      "src/app/v2/actions.test.ts",
      'import { prisma } from "@/lib/prisma";\n',
    );
    writeFixtureFile(root, "scripts/v2/smoke-core.ts", 'console.log("smoke");\n');
    writeFixtureFile(root, "scripts/v2/helper.ts", 'console.log("helper");\n');
    writeFixtureFile(root, "scripts/v2/nested/smoke-deep.ts", 'console.log("deep");\n');

    assert.deepEqual(await discoverMode("unit", { root }), [
      "src/app/v2/_lib/helper.test.ts",
      "src/v2/domain/pure.test.ts",
      "src/v2/navigation.test.ts",
    ]);
    assert.deepEqual(await discoverMode("integration", { root }), [
      "src/app/v2/_lib/helper.test.ts",
      "src/app/v2/actions.test.ts",
      "src/v2/domain/db-backed.test.ts",
      "src/v2/domain/pure.test.ts",
      "src/v2/navigation.test.ts",
      "src/v2/services/order.test.ts",
    ]);
    assert.deepEqual(await discoverMode("smoke", { root }), ["scripts/v2/smoke-core.ts"]);

    // Adding a new compliant unit, integration and smoke file must be picked
    // up by re-discovery without editing the runner or this self-check.
    writeFixtureFile(root, "src/v2/domain/new-pure.test.ts", 'import assert from "node:assert/strict";\n');
    writeFixtureFile(root, "src/app/v2/_lib/new-helper.test.ts", 'import assert from "node:assert/strict";\n');
    writeFixtureFile(root, "scripts/v2/smoke-new.ts", 'console.log("new smoke");\n');
    writeFixtureFile(
      root,
      "src/app/v2/new-db.test.ts",
      'import { prisma } from "@/lib/prisma";\n',
    );

    const unitAfter = await discoverMode("unit", { root });
    assert.ok(unitAfter.includes("src/v2/domain/new-pure.test.ts"));
    assert.ok(unitAfter.includes("src/app/v2/_lib/new-helper.test.ts"));
    assert.equal(unitAfter.includes("src/app/v2/new-db.test.ts"), false);
    assert.deepEqual(unitAfter, [...unitAfter].sort());
    assert.equal(new Set(unitAfter).size, unitAfter.length);

    const integrationAfter = await discoverMode("integration", { root });
    assert.ok(integrationAfter.includes("src/v2/domain/new-pure.test.ts"));
    assert.ok(integrationAfter.includes("src/app/v2/new-db.test.ts"));
    assert.deepEqual(integrationAfter, [...integrationAfter].sort());

    assert.ok((await discoverMode("smoke", { root })).includes("scripts/v2/smoke-new.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fixture root with missing trees or required files fails discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "wms-v2-discovery-missing-"));
  try {
    writeFixtureFile(root, "src/app/v2/_lib/helper.test.ts", 'import assert from "node:assert/strict";\n');
    await assert.rejects(discoverMode("unit", { root }), (error) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.exitCode, 1);
      assert.match(error.message, /Missing test (directory|file)/);
      return true;
    });
    await assert.rejects(discoverMode("smoke", { root }), (error) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.exitCode, 1);
      assert.match(error.message, /Missing test directory/);
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("managed DB env accepts the explicit loopback contract", () => {
  assert.deepEqual(validateManagedDbEnv(VALID_ENV), { database: VALID_DATABASE });
  assert.deepEqual(
    validateManagedDbEnv({
      WMS_TEST_DB_MANAGED: "1",
      V2_DATABASE_URL: `postgres://u@127.0.0.1:55432/${VALID_DATABASE}`,
    }),
    { database: VALID_DATABASE },
  );
});

test("managed DB env rejects missing or unsafe values", () => {
  const invalid = [
    [{ V2_DATABASE_URL: VALID_URL }, /WMS_TEST_DB_MANAGED/],
    [{ WMS_TEST_DB_MANAGED: "true", V2_DATABASE_URL: VALID_URL }, /WMS_TEST_DB_MANAGED/],
    [{ WMS_TEST_DB_MANAGED: "0", V2_DATABASE_URL: VALID_URL }, /WMS_TEST_DB_MANAGED/],
    [{ WMS_TEST_DB_MANAGED: "1" }, /V2_DATABASE_URL is required/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: "" }, /V2_DATABASE_URL is required/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: ` ${VALID_URL} ` }, /surrounding whitespace/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: "not a url" }, /valid PostgreSQL URL/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace("postgresql:", "mysql:") }, /postgres/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace("127.0.0.1", "localhost") }, /127\.0\.0\.1/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace("127.0.0.1", "127.0.0.2") }, /127\.0\.0\.1/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace("127.0.0.1", "[::1]") }, /127\.0\.0\.1/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace("127.0.0.1", "0.0.0.0") }, /127\.0\.0\.1/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(":55432", "") }, /explicit port/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(":55432", ":5432") }, /default PostgreSQL port/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(":55432", ":0") }, /port must be 1-65535/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(":55432", ":70000") }, /valid PostgreSQL URL/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: `${VALID_URL}?sslmode=disable` }, /query or fragment/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: `${VALID_URL}#fragment` }, /query or fragment/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: `${VALID_URL}?` }, /query or fragment/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(VALID_DATABASE, "wms_0123456789abcde_test") }, /wms_/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(VALID_DATABASE, "wms_0123456789ABCDEF_test") }, /wms_/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: VALID_URL.replace(VALID_DATABASE, "wms_0123456789abcdef_dev") }, /wms_/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: `${VALID_URL}/extra` }, /wms_/],
    [{ WMS_TEST_DB_MANAGED: "1", V2_DATABASE_URL: "postgres://127.0.0.1:55432/" }, /wms_/],
  ];

  for (const [env, pattern] of invalid) {
    assertUsageError(() => validateManagedDbEnv(env), pattern);
  }
});

test("managed DB env errors never echo the URL or credentials", () => {
  const secret = "not-a-real-credential";
  const env = {
    WMS_TEST_DB_MANAGED: "1",
    V2_DATABASE_URL: `postgresql://user:${secret}@localhost:55432/${VALID_DATABASE}`,
  };
  assert.throws(
    () => validateManagedDbEnv(env),
    (error) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes("55432"), false);
      assert.equal(error.message.includes(VALID_DATABASE), false);
      return true;
    },
  );
});

test("--list prints discovered paths without any database env", async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    assert.equal(await main(["integration", "--list"], {}), 0);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(lines, await discoverMode("integration"));
});

test("database modes refuse before spawning when the env contract is absent or unsafe", async () => {
  await assert.rejects(main(["integration"], {}), (error) => {
    assert.ok(error instanceof RunnerError);
    assert.equal(error.exitCode, 2);
    assert.match(error.message, /WMS_TEST_DB_MANAGED/);
    return true;
  });
  await assert.rejects(main(["smoke"], { WMS_TEST_DB_MANAGED: "1" }), (error) => {
    assert.ok(error instanceof RunnerError);
    assert.equal(error.exitCode, 2);
    assert.match(error.message, /V2_DATABASE_URL is required/);
    return true;
  });
  await assert.rejects(
    main(["integration"], {
      WMS_TEST_DB_MANAGED: "1",
      V2_DATABASE_URL: VALID_URL.replace("127.0.0.1", "localhost"),
    }),
    (error) => {
      assert.ok(error instanceof RunnerError);
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /127\.0\.0\.1/);
      return true;
    },
  );
});
