/**
 * Sprint E1.4 · special cases for the isolated PostgreSQL test database harness.
 *
 * Covered here:
 *   1. concurrent isolation  — two harness runs at the same time must use
 *      different ports/databases and must remove their own temporary clusters;
 *   2. PostgreSQL unavailable — an empty PG_BIN directory must fail fast with a
 *      PG tool hint, exit code 1 and no temporary cluster left behind;
 *   3. migration failure     — a deterministic preload makes only
 *      `prisma migrate deploy` fail, and the harness must name the failing npm
 *      script, keep secrets redacted, exit 1 and clean the cluster;
 *   4. interrupt exit        — a wrapper process calls the exported `main()`,
 *      emits SIGINT on the harness process once the callback is running, and
 *      the harness must exit 130 after cleaning up.
 *
 * Windows note: `child.kill("SIGINT")` cannot deliver a real SIGINT to a child
 * process, so case 4 does not simulate an operating-system signal. It calls
 * `process.emit("SIGINT")` inside the harness process itself, which runs the
 * same `process.on("SIGINT")` handler path that a real delivery would run.
 *
 * Sandbox note: some confined DSH sandboxes deny pipe-backed child stdio
 * (spawn EPERM) and therefore also the default node test-runner isolation.
 * Every subprocess here uses file descriptor capture instead of pipes, so the
 * file can run with `node --test --test-isolation=none
 * scripts/v2-test-db-harness-specials.test.mjs` in those environments and with
 * the plain `node --test scripts/v2-test-db-harness-specials.test.mjs`
 * elsewhere.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const HARNESS_SCRIPT = join(SCRIPT_DIR, "with-v2-test-db.mjs");
const CLUSTER_PREFIX = "wms-v2-test-pg-";
const HARNESS_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 420_000;
const CAPTURE_PREFIX = "wms-harness-specials-capture-";
const REPORT_CALLBACK = [
  "const url = new URL(process.env.V2_DATABASE_URL);",
  "const report = {",
  "  port: Number(url.port),",
  "  database: decodeURIComponent(url.pathname.slice(1)),",
  "  managed: process.env.WMS_TEST_DB_MANAGED,",
  "  nodeEnv: process.env.NODE_ENV,",
  "};",
  'process.stdout.write(JSON.stringify(report) + "\\n");',
].join(" ");

const PRELOAD_SOURCE = `"use strict";
// Deterministic failure injection: only the Prisma CLI running
// "migrate deploy" exits with 42. The database target checker, npm itself and
// the seed/check migration scripts are deliberately unaffected.
const argv = process.argv.slice(1);
const prismaCli = argv.find((arg) => /[\\\\/]prisma[\\\\/]build[\\\\/]index\\.js$/iu.test(arg));
const cliIndex = prismaCli ? argv.indexOf(prismaCli) : -1;
const command = cliIndex >= 0 ? argv.slice(cliIndex + 1) : [];
if (prismaCli && command.includes("migrate") && command.includes("deploy")) {
  console.error("[specials-preload] simulated prisma migrate deploy failure");
  process.exit(42);
}
`;

const INTERRUPT_WRAPPER_SOURCE = `import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [harnessPath, markerPath] = process.argv.slice(2);
const { main } = await import(pathToFileURL(harnessPath).href);

const callbackSource =
  "require(\\"node:fs\\").writeFileSync(" +
  JSON.stringify(markerPath) +
  ", \\"callback-started\\"); setInterval(() => {}, 1000);";

let interrupted = false;
const poll = setInterval(() => {
  if (interrupted || !existsSync(markerPath)) return;
  interrupted = true;
  clearInterval(poll);
  console.error("[interrupt-wrapper] callback active; emitting SIGINT");
  process.emit("SIGINT");
}, 25);

const guard = setTimeout(() => {
  if (!interrupted) {
    console.error("[interrupt-wrapper] callback did not start; aborting");
    process.exit(99);
  }
}, 120000);

const code = await main(["--", "node", "-e", callbackSource]);
clearInterval(poll);
clearTimeout(guard);
console.error(\`[interrupt-wrapper] main returned \${code}\`);
process.exitCode = code;
`;

// Any cluster directory that already exists when this file starts is not owned
// by this test file (it may belong to a concurrently running agent or be a
// pre-existing leftover). Only directories that appear after this snapshot are
// checked for leaks.
const INITIAL_CLUSTER_DIRS = listClusterDirs();

function listClusterDirs() {
  try {
    return new Set(
      readdirSync(tmpdir(), { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && entry.name.startsWith(CLUSTER_PREFIX),
        )
        .map((entry) => entry.name),
    );
  } catch {
    return new Set();
  }
}

function hasLivePostmaster(name) {
  return existsSync(join(tmpdir(), name, "data", "postmaster.pid"));
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function readFileSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run a node command with file-descriptor stdio capture (no pipes, so this
 * also works in confined sandboxes that deny pipe-backed child stdio).
 * @param {string[]} args arguments for the current node binary
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number}} [options]
 */
function runNodeCaptured(args, options = {}) {
  const {
    cwd = PROJECT_ROOT,
    env = process.env,
    timeoutMs = HARNESS_TIMEOUT_MS,
  } = options;

  return new Promise((resolvePromise) => {
    const captureDir = mkdtempSync(join(tmpdir(), CAPTURE_PREFIX));
    const nonce = randomBytes(4).toString("hex");
    const stdoutPath = join(captureDir, `${nonce}.out`);
    const stderrPath = join(captureDir, `${nonce}.err`);
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");

    let child;
    let settled = false;
    let timedOut = false;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = readFileSafe(stdoutPath);
      const stderr = readFileSafe(stderrPath);
      rmSync(captureDir, { recursive: true, force: true });
      resolvePromise({ ...result, stdout, stderr, timedOut });
    };

    try {
      child = spawn(process.execPath, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
    } catch (error) {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      rmSync(captureDir, { recursive: true, force: true });
      resolvePromise({
        code: null,
        signal: null,
        error,
        stdout: "",
        stderr: "",
        timedOut: false,
      });
      return;
    }
    // The child inherited duplicates; the parent no longer needs these.
    closeSync(stdoutFd);
    closeSync(stderrFd);

    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      finish({ code: null, signal: null, error });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, error: null });
    });
  });
}

function runHarnessCaptured(extraArgs, options = {}) {
  return runNodeCaptured([HARNESS_SCRIPT, ...extraArgs], options);
}

function parseReport(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  assert.ok(last, "callback produced no stdout report");
  return JSON.parse(last);
}

function parseReadyLines(stderr) {
  const pattern =
    /\[wms-test-db\] ready: PostgreSQL (\S+) on 127\.0\.0\.1:(\d+); database (wms_[a-f0-9]{16,}_test)/gu;
  return [...String(stderr ?? "").matchAll(pattern)].map((match) => ({
    version: match[1],
    port: Number(match[2]),
    database: match[3],
  }));
}

function formatResult(label, result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return [
    `${label}: exit=${result.code} signal=${result.signal} timedOut=${result.timedOut}`,
    output ? `output:\n${output}` : "output: <empty>",
  ].join("\n");
}

/**
 * Assert that no temporary cluster directory created during a test is still
 * present. A directory that appeared after the baseline but still has a live
 * postmaster.pid belongs to another running process (for example another agent
 * running its own isolated cluster), so it is reported and ignored. A stopped
 * cluster directory that still exists is a leak and fails the test.
 * @param {import("node:test").TestContext} t
 * @param {Set<string>} baseline
 */
async function assertNoNewClusterLeaks(t, baseline) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const current = listClusterDirs();
    const appeared = [...current].filter((name) => !baseline.has(name));
    if (appeared.length === 0) {
      t.diagnostic(
        `temporary cluster scan: no new ${CLUSTER_PREFIX}* directories ` +
          `(baseline=${baseline.size}, current=${current.size})`,
      );
      return;
    }
    const stopped = appeared.filter((name) => !hasLivePostmaster(name));
    if (stopped.length === 0) {
      t.diagnostic(
        `temporary cluster scan: ${appeared.length} new director(y/ies) belong ` +
          `to a live PostgreSQL server owned by another process, ignored: ` +
          appeared.join(", "),
      );
      return;
    }
    if (Date.now() >= deadline) {
      assert.fail(
        `temporary PostgreSQL cluster directories were not cleaned up: ` +
          stopped.join(", "),
      );
    }
    // Give a concurrently shutting down cluster a moment to finish removing
    // its own directory before treating it as a leak.
    await delay(500);
  }
}

function assertNoRawSecrets(text, label) {
  assert.doesNotMatch(
    text,
    /postgres(?:ql)?:\/\/(?!\[redacted\])[^\s"'<>]*/iu,
    `${label}: a raw PostgreSQL URL leaked into harness output`,
  );
  assert.doesNotMatch(
    text,
    /PGPASSWORD=(?!\[redacted\])\S+/iu,
    `${label}: a raw PGPASSWORD value leaked into harness output`,
  );
}

test(
  "concurrent harness runs use distinct ports/databases and clean up their own clusters",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const baseline = INITIAL_CLUSTER_DIRS;
    const callbackArgs = ["--", "node", "-e", REPORT_CALLBACK];

    const [first, second] = await Promise.all([
      runHarnessCaptured(callbackArgs),
      runHarnessCaptured(callbackArgs),
    ]);

    assert.equal(
      first.code,
      0,
      formatResult("first concurrent harness", first),
    );
    assert.equal(
      second.code,
      0,
      formatResult("second concurrent harness", second),
    );

    const firstReport = parseReport(first.stdout);
    const secondReport = parseReport(second.stdout);
    const firstReady = parseReadyLines(first.stderr);
    const secondReady = parseReadyLines(second.stderr);

    assert.equal(firstReady.length, 1, formatResult("first ready line", first));
    assert.equal(
      secondReady.length,
      1,
      formatResult("second ready line", second),
    );

    for (const [label, report, ready] of [
      ["first", firstReport, firstReady[0]],
      ["second", secondReport, secondReady[0]],
    ]) {
      assert.match(report.database, /^wms_[a-f0-9]{16,}_test$/u);
      assert.equal(report.managed, "1", `${label}: managed env marker`);
      assert.equal(report.nodeEnv, "test", `${label}: NODE_ENV`);
      assert.notEqual(report.port, 5432, `${label}: default port rejected`);
      assert.equal(
        ready.port,
        report.port,
        `${label}: ready log port matches callback environment`,
      );
      assert.equal(
        ready.database,
        report.database,
        `${label}: ready log database matches callback environment`,
      );
    }

    assert.notEqual(
      firstReport.port,
      secondReport.port,
      `concurrent harnesses shared port ${firstReport.port}: ` +
        `${formatResult("first", first)} ${formatResult("second", second)}`,
    );
    assert.notEqual(
      firstReport.database,
      secondReport.database,
      "concurrent harnesses shared a database name",
    );
    t.diagnostic(
      `concurrent isolation: ports ${firstReport.port}/${secondReport.port}; ` +
        `databases ${firstReport.database}/${secondReport.database}`,
    );

    await assertNoNewClusterLeaks(t, baseline);
  },
);

test(
  "fails fast with a PG_BIN tool hint when PostgreSQL tools are unavailable and leaves no cluster",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const baseline = INITIAL_CLUSTER_DIRS;
    const emptyPgBin = mkdtempSync(join(tmpdir(), "wms-harness-specials-empty-pgbin-"));
    try {
      const result = await runHarnessCaptured(
        ["--", "node", "-e", "process.exit(0)"],
        { env: { ...process.env, PG_BIN: emptyPgBin } },
      );

      assert.equal(
        result.code,
        1,
        formatResult("PG_BIN-unavailable harness", result),
      );
      assert.match(result.stderr, /PG_BIN/u);
      assert.match(result.stderr, /initdb/iu);
      assert.equal(result.stdout.trim(), "");
      t.diagnostic(`failure message: ${result.stderr.trim().split(/\r?\n/u)[0]}`);
    } finally {
      rmSync(emptyPgBin, { recursive: true, force: true });
    }

    await assertNoNewClusterLeaks(t, baseline);
  },
);

test(
  "reports a failed migration script, redacts secrets, exits 1 and cleans the cluster",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const baseline = INITIAL_CLUSTER_DIRS;
    const tempRoot = mkdtempSync(join(tmpdir(), "wms-harness-specials-migrate-"));
    try {
      const preloadPath = join(tempRoot, "preload.cjs");
      // NODE_OPTIONS arguments are whitespace separated; keep the path simple.
      assert.equal(
        preloadPath.includes(" "),
        false,
        "temporary preload path unexpectedly contains whitespace",
      );
      writeFileSync(preloadPath, PRELOAD_SOURCE, "utf8");

      const inheritedNodeOptions = (process.env.NODE_OPTIONS ?? "").trim();
      const nodeOptions = [inheritedNodeOptions, `--require=${preloadPath}`]
        .filter(Boolean)
        .join(" ");

      const result = await runHarnessCaptured(
        ["--", "node", "-e", "process.exit(0)"],
        { env: { ...process.env, NODE_OPTIONS: nodeOptions } },
      );

      const combined = `${result.stdout}\n${result.stderr}`;
      assert.equal(
        result.code,
        1,
        formatResult("migration-failure harness", result),
      );
      // The harness must point at the exact npm script that failed.
      assert.match(result.stderr, /npm run db:v2:migrate:deploy/u);
      // The injected failure must come from the Prisma CLI, not from the
      // database target checker that runs earlier in the same npm script.
      assert.match(result.stderr, /specials-preload/u);
      assert.doesNotMatch(
        combined,
        /V2_DATABASE_URL is required|must name a PostgreSQL database|V1 and V2 must use distinct/u,
        "the database target checker failed before the injected migration failure",
      );
      assertNoRawSecrets(combined, "migration failure");
      t.diagnostic(
        `failure message: ${result.stderr
          .trim()
          .split(/\r?\n/u)
          .find((line) => line.includes("npm run db:v2:migrate:deploy")) ?? "<missing>"}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    await assertNoNewClusterLeaks(t, baseline);
  },
);

test(
  "exits 130 after SIGINT is emitted once the callback is running and cleans the cluster",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const baseline = INITIAL_CLUSTER_DIRS;
    const tempRoot = mkdtempSync(join(tmpdir(), "wms-harness-specials-interrupt-"));
    try {
      const wrapperPath = join(tempRoot, "interrupt-wrapper.mjs");
      const markerPath = join(tempRoot, "callback-started.marker");
      writeFileSync(wrapperPath, INTERRUPT_WRAPPER_SOURCE, "utf8");

      // The wrapper imports the harness `main()` export, runs a long callback
      // and emits SIGINT inside the harness process once the callback process
      // has started. This is the same handler path as an OS-delivered SIGINT
      // (which cannot be delivered to a child process on Windows).
      const result = await runNodeCaptured([wrapperPath, HARNESS_SCRIPT, markerPath]);

      assert.equal(
        result.code,
        130,
        `${formatResult("interrupt harness", result)}\n` +
          "expected 128 + SIGINT(2) = 130",
      );
      assert.match(result.stderr, /\[wms-test-db\] ready:/u);
      assert.match(result.stderr, /\[interrupt-wrapper\] callback active; emitting SIGINT/u);
      assert.match(result.stderr, /\[interrupt-wrapper\] main returned 130/u);
      assert.equal(
        existsSync(markerPath),
        true,
        "the callback must have started before SIGINT was emitted",
      );

      const readyIndex = result.stderr.indexOf("[wms-test-db] ready:");
      const returnedIndex = result.stderr.indexOf(
        "[interrupt-wrapper] main returned 130",
      );
      assert.ok(readyIndex >= 0, "harness never reported ready");
      assert.ok(
        returnedIndex > readyIndex,
        "interrupt wrapper reported the exit code before provisioning finished",
      );
      t.diagnostic(
        "interrupt path: provisioning completed, callback started, " +
          "SIGINT handler returned 130 and the cluster was removed",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    await assertNoNewClusterLeaks(t, baseline);
  },
);
