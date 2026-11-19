#!/usr/bin/env node
// Focused V2 test runner.
//
// Usage: node scripts/test-v2.mjs unit|integration|smoke [--list]
//
// Unit runs only the DB-free V2 domain tree, navigation and the DB-free
// src/app/v2 helper tests. A test is classified as DB-free by its imports, not
// by a fixed file list, so a new pure test is picked up without editing this
// runner while a new database-backed test stays in Integration only.
// Integration deliberately overlaps Unit and runs every src/v2 and src/app/v2
// *.test.ts file; smoke runs every scripts/v2/smoke-*.ts file. Database modes
// require an explicit managed test database and run serially against the shared
// seed. This script intentionally does not load dotenv: the caller must supply
// the explicit environment contract.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const TSX_CLI = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TSX_CLI_RELATIVE = "node_modules/tsx/dist/cli.mjs";
const TEST_FILE_PATTERN = /\.test\.ts$/;
const MAX_CAPTURED_OUTPUT = 512 * 1024;
const USAGE = "Usage: node scripts/test-v2.mjs unit|integration|smoke [--list]";

// Modules that require a database, a server request context or the Prisma
// client. A test importing any of them is excluded from the DB-free Unit group.
// Only import/require specifiers are inspected, so fixture strings that merely
// mention a service module do not change the classification.
const DATABASE_MODULE_PATTERNS = Object.freeze([
  /^@prisma\/(?:client|adapter-pg)$/,
  /^@\/lib\/prisma(?:\/|$)/,
  /^@\/lib\/tenant\//,
  /^@\/v2\/services\//,
  /(?:^|\/)generated\/prisma(?:[-/]|$)/,
  /^server-only$/,
]);

function importSpecifiers(source) {
  const specifiers = [];
  const importPattern = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(source)) !== null) specifiers.push(match[1]);
  const requirePattern = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requirePattern.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

export function isDatabaseFreeTestSource(source) {
  const text = String(source ?? "");
  return !importSpecifiers(text).some((specifier) =>
    DATABASE_MODULE_PATTERNS.some((pattern) => pattern.test(specifier)),
  );
}

export const MODES = Object.freeze(["unit", "integration", "smoke"]);

export class RunnerError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "RunnerError";
    this.exitCode = exitCode;
  }
}

function usageError(message) {
  return new RunnerError(message, 2);
}

function discoveryError(message) {
  return new RunnerError(message, 1);
}

export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let list = false;
  let mode;

  for (const arg of args) {
    if (arg === "--list") {
      list = true;
      continue;
    }
    if (typeof arg !== "string" || arg.startsWith("-")) {
      throw usageError("Unknown option");
    }
    if (mode !== undefined) {
      throw usageError("Unexpected argument");
    }
    mode = arg;
  }

  if (mode === undefined) {
    throw usageError("Mode is required");
  }
  if (!MODES.includes(mode)) {
    throw usageError("Unknown mode");
  }

  return { mode, list };
}

function sortedEntries(entries) {
  return [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

async function collectTree(root, relativeDirectory, accept, { recursive = true } = {}) {
  const absoluteDirectory = resolve(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw discoveryError(`Missing test directory: ${relativeDirectory}`);
    }
    throw error;
  }

  const files = [];
  for (const entry of sortedEntries(entries)) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...(await collectTree(root, relativePath, accept, { recursive })));
      }
      continue;
    }
    if (entry.isFile() && accept(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

async function collectFile(root, relativePath) {
  const absolutePath = resolve(root, relativePath);
  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      throw discoveryError(`Missing test file: ${relativePath}`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw discoveryError(`Missing test file: ${relativePath}`);
  }
  return [relativePath];
}

async function filterDatabaseFree(root, relativePaths) {
  const files = [];
  for (const relativePath of relativePaths) {
    const source = await readFile(resolve(root, relativePath), "utf8");
    if (isDatabaseFreeTestSource(source)) {
      files.push(relativePath);
    }
  }
  return files;
}

export function assertFilesFound(files, mode) {
  if (!Array.isArray(files) || files.length === 0) {
    throw discoveryError(`No ${mode} test files matched`);
  }
  return files;
}

export async function discoverMode(mode, { root = PROJECT_ROOT } = {}) {
  if (!MODES.includes(mode)) {
    throw usageError("Unknown mode");
  }

  let files;
  if (mode === "unit") {
    const candidates = [
      ...(await collectTree(root, "src/v2/domain", (name) => TEST_FILE_PATTERN.test(name))),
      ...(await collectFile(root, "src/v2/navigation.test.ts")),
      ...(await collectTree(root, "src/app/v2", (name) => TEST_FILE_PATTERN.test(name))),
    ];
    files = await filterDatabaseFree(root, candidates);
  } else if (mode === "integration") {
    files = [
      ...(await collectTree(root, "src/v2", (name) => TEST_FILE_PATTERN.test(name))),
      ...(await collectTree(root, "src/app/v2", (name) => TEST_FILE_PATTERN.test(name))),
    ];
  } else {
    files = await collectTree(
      root,
      "scripts/v2",
      (name) => name.startsWith("smoke-") && name.endsWith(".ts"),
      { recursive: false },
    );
  }

  return [...new Set(files)].sort();
}

// The managed database contract is intentionally strict: database modes must
// never fall back to a developer or production URL. Errors name variables and
// expectations only, never the supplied URL or its credentials.
export function validateManagedDbEnv(env = process.env) {
  if (env.WMS_TEST_DB_MANAGED !== "1") {
    throw usageError("WMS_TEST_DB_MANAGED=1 is required");
  }

  const raw = env.V2_DATABASE_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    throw usageError("V2_DATABASE_URL is required");
  }
  if (raw !== raw.trim()) {
    throw usageError("V2_DATABASE_URL must not contain surrounding whitespace");
  }
  if (/[?#]/.test(raw)) {
    throw usageError("V2_DATABASE_URL must not include a query or fragment");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw usageError("V2_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw usageError("V2_DATABASE_URL must use postgres:// or postgresql://");
  }
  if (url.hostname !== "127.0.0.1") {
    throw usageError("V2_DATABASE_URL host must be 127.0.0.1");
  }
  if (url.port === "") {
    throw usageError("V2_DATABASE_URL must include an explicit port");
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw usageError("V2_DATABASE_URL port must be 1-65535");
  }
  if (port === 5432) {
    throw usageError("V2_DATABASE_URL must not use the default PostgreSQL port 5432");
  }
  if (url.search !== "" || url.hash !== "") {
    throw usageError("V2_DATABASE_URL must not include a query or fragment");
  }

  let database;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw usageError("V2_DATABASE_URL database name has invalid percent-encoding");
  }

  if (!url.pathname.startsWith("/") || database.includes("/") || !/^wms_[a-f0-9]{16,}_test$/.test(database)) {
    throw usageError("V2_DATABASE_URL database must match wms_<16+ lowercase hex>_test");
  }

  return Object.freeze({ database });
}

function signalExitCode(signal) {
  const number = osConstants.signals?.[signal];
  return Number.isInteger(number) ? 128 + number : 1;
}

function appendCapturedOutput(output, chunk) {
  output.text += chunk.toString();
  if (output.text.length > MAX_CAPTURED_OUTPUT) {
    output.text = output.text.slice(-MAX_CAPTURED_OUTPUT / 2);
  }
}

function runTestFile(relativePath, childEnv) {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  let child;
  try {
    child = spawn(process.execPath, [TSX_CLI, absolutePath], {
      cwd: PROJECT_ROOT,
      env: childEnv,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.resolve({ ok: false, exitCode: 1, reason: `failed to start: ${message}` });
  }

  const output = { text: "" };
  const forwardedSignals = new Map();
  let settled = false;

  return new Promise((resolvePromise) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of forwardedSignals) {
        process.off(signal, handler);
      }
      resolvePromise(result);
    };

    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => {
        if (!child.killed) child.kill(signal);
      };
      forwardedSignals.set(signal, handler);
      process.on(signal, handler);
    }

    child.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
      appendCapturedOutput(output, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      appendCapturedOutput(output, chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, exitCode: 1, reason: `failed to start: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      if (signal) {
        finish({ ok: false, exitCode: signalExitCode(signal), reason: `terminated by ${signal}` });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, exitCode: code ?? 1, reason: `exit code ${code ?? 1}` });
        return;
      }
      if (/\bskipped\b/i.test(output.text)) {
        finish({ ok: false, exitCode: 1, reason: "reported a skip" });
        return;
      }
      finish({ ok: true, exitCode: 0 });
    });
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { mode, list } = parseArgs(argv);
  const files = assertFilesFound(await discoverMode(mode), mode);

  if (list) {
    for (const file of files) {
      console.log(file);
    }
    return 0;
  }

  if (mode !== "unit") {
    validateManagedDbEnv(env);
  }

  if (!existsSync(TSX_CLI)) {
    throw new RunnerError(`Local tsx entrypoint not found: ${TSX_CLI_RELATIVE}`, 1);
  }

  const childEnv = { ...env, NODE_ENV: "test" };
  if (mode !== "unit") {
    childEnv.WMS_TEST_DB_MANAGED = "1";
    // Exact opt-ins used by the existing DB tests so a skipped DB check is a
    // failure. V2_AUTH_REQUIRE_DB is read by src/v2/auth-source.test.ts.
    childEnv.V2_AUTH_REQUIRE_DB = "1";
    childEnv.V2_STAFF_REQUIRE_DB = "1";
  }

  console.log(`Running ${mode} (${files.length} file${files.length === 1 ? "" : "s"})`);
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    console.log(`[${index + 1}/${files.length}] ${file}`);
    const result = await runTestFile(file, childEnv);
    if (!result.ok) {
      console.error(`FAILED ${file}: ${result.reason}`);
      return result.exitCode;
    }
  }

  console.log(`Passed ${files.length} ${mode} file${files.length === 1 ? "" : "s"}`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);
const isDirectRun =
  invokedPath !== "" &&
  (invokedPath === modulePath ||
    (process.platform === "win32" && invokedPath.toLowerCase() === modulePath.toLowerCase()));

if (isDirectRun) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const exitCode = error instanceof RunnerError ? error.exitCode : 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`test-v2: ${message}`);
      if (exitCode === 2) {
        console.error(USAGE);
      }
      process.exitCode = exitCode;
    });
}
