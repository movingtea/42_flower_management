#!/usr/bin/env node
/**
 * Run a command against a throw-away PostgreSQL cluster that belongs to this
 * invocation only.
 *
 * Usage:
 *   node scripts/with-v2-test-db.mjs -- <node|npm> [args...]
 *
 * The harness never reads a caller database URL and never connects to an
 * existing PostgreSQL instance. It creates an mkdtemp-owned cluster, starts it
 * on a random loopback port with a per-run password, applies the existing V2
 * migration/seed npm scripts, runs the callback once, and then removes only the
 * cluster it created.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOST = "127.0.0.1";
export const DEFAULT_POSTGRES_PORT = 5432;
export const TEST_DB_NAME_PATTERN = /^wms_[a-f0-9]{16,}_test$/;
export const MANAGED_ENV_NAME = "WMS_TEST_DB_MANAGED";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLUSTER_PREFIX = "wms-v2-test-pg-";
const MAX_CAPTURE_BYTES = 1_000_000;
const PROVISION_TIMEOUT_MS = 240_000;
const INITDB_TIMEOUT_MS = 120_000;
const PG_START_TIMEOUT_MS = 120_000;
const PG_STOP_TIMEOUT_MS = 90_000;
const PORT_START_ATTEMPTS = 6;
const MIGRATION_SCRIPTS = [
  "db:v2:migrate:deploy",
  "db:v2:migrate:check",
  "db:v2:seed:test",
];

const USAGE = `Usage: node scripts/with-v2-test-db.mjs [--legacy] -- <node|npm> [args...]

Creates an isolated temporary PostgreSQL cluster, applies the V2 test schema and
seed, then runs the command once with:
  NODE_ENV=test
  ${MANAGED_ENV_NAME}=1
  V2_DATABASE_URL=<owned wms_<hex>_test database on 127.0.0.1:<random port>>
  DATABASE_URL=<separate synthetic database on the same temporary server>

--legacy additionally initializes DATABASE_URL with the current V1 schema via
Prisma db push. It is opt-in because the legacy test:all path writes to the V1
database. No force-reset or caller database is used.

Examples:
  node scripts/with-v2-test-db.mjs -- node -e "console.log(new URL(process.env.V2_DATABASE_URL).hostname)"
  node scripts/with-v2-test-db.mjs -- node --test scripts/with-v2-test-db.test.mjs
  node scripts/with-v2-test-db.mjs -- npm run db:v2:migrate:status
  node scripts/with-v2-test-db.mjs --legacy -- npm run test:all

The cluster and both databases are private to this run and are removed afterwards.`;

const SIGNAL_NUMBERS = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessError";
    this.exitCode = 1;
  }
}

function normalizeRunner(token) {
  const name = basename(token).toLowerCase().replace(/\.(exe|cmd|bat)$/u, "");
  if (name === "node" || name === "npm") return name;
  throw new UsageError(
    `Unsupported command "${token}". Only "node" and "npm" are supported.`,
  );
}

function validateNodeArgs(args) {
  if (args.length === 0) {
    throw new UsageError("node needs a script, --test, or -e/--eval argument.");
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["-e", "--eval", "-p", "--print"].includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) {
        throw new UsageError(`${arg} needs a JavaScript expression argument.`);
      }
    } else {
      const inlineEval = /^--(?:eval|print)=([\s\S]*)$/u.exec(arg);
      if (inlineEval && inlineEval[1].length === 0) {
        throw new UsageError(`${arg} needs a JavaScript expression argument.`);
      }
    }
  }

  const first = args[0];
  if (!first.startsWith("-")) {
    const looksLikeScript =
      first.includes("/") ||
      first.includes("\\") ||
      [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(
        extname(first).toLowerCase(),
      );
    if (looksLikeScript && !existsSync(resolve(process.cwd(), first))) {
      throw new UsageError(`node script not found: ${first}`);
    }
  }
}

function validateNpmArgs(args) {
  if (args.length === 0) {
    throw new UsageError('npm needs a subcommand, for example "npm run test:x".');
  }
}

/**
 * Parse and validate the CLI before any PostgreSQL process is created.
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseCliArgs(argv) {
  if (
    argv.length === 1 &&
    (argv[0] === "--help" || argv[0] === "-h")
  ) {
    return { help: true };
  }

  const separator = argv.indexOf("--");
  if (separator === -1) {
    throw new UsageError('Expected "--" before the command.');
  }

  let legacy = false;
  for (const option of argv.slice(0, separator)) {
    if (option === "--legacy") {
      legacy = true;
      continue;
    }
    throw new UsageError(`Unknown option "${option}".`);
  }

  const commandArgs = argv.slice(separator + 1);
  if (commandArgs.length === 0) {
    throw new UsageError("Expected node or npm after --.");
  }

  const runner = normalizeRunner(commandArgs[0]);
  const args = commandArgs.slice(1);
  if (runner === "node") validateNodeArgs(args);
  else validateNpmArgs(args);

  return { help: false, legacy, runner, args };
}

function postgresUrl({ port, user, password, database }) {
  const url = new URL("postgresql://127.0.0.1");
  url.username = user;
  url.password = password;
  url.port = String(port);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Build the generated names, credentials and URLs for one run.
 * @param {{port: number, hex?: string, user?: string, password?: string}} options
 */
export function buildDatabasePlan({
  port,
  hex = randomBytes(16).toString("hex"),
  user = `wms_owner_${randomBytes(4).toString("hex")}`,
  password = randomBytes(24).toString("base64url"),
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HarnessError("A valid TCP port is required.");
  }
  if (port === DEFAULT_POSTGRES_PORT) {
    throw new HarnessError("Refusing to use the default PostgreSQL port 5432.");
  }
  if (typeof hex !== "string" || !/^[a-f0-9]{16,40}$/iu.test(hex)) {
    throw new HarnessError("Database suffix must be 16-40 hexadecimal characters.");
  }
  if (typeof user !== "string" || !/^[a-z][a-z0-9_]{0,62}$/u.test(user)) {
    throw new HarnessError("Generated PostgreSQL user name is not a valid identifier.");
  }
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    /[\r\n]/u.test(password)
  ) {
    throw new HarnessError("A per-run PostgreSQL password of at least 16 characters is required.");
  }

  const suffix = hex.toLowerCase();
  const v2Database = `wms_${suffix}_test`;
  const legacyDatabase = `wms_${suffix}_legacy_test`;
  if (!TEST_DB_NAME_PATTERN.test(v2Database) || v2Database === legacyDatabase) {
    throw new HarnessError("Generated V2 test database name is invalid.");
  }

  return {
    host: HOST,
    port,
    user,
    password,
    v2Database,
    legacyDatabase,
    v2Url: postgresUrl({
      port,
      user,
      password,
      database: v2Database,
    }),
    legacyUrl: postgresUrl({
      port,
      user,
      password,
      database: legacyDatabase,
    }),
  };
}

function setPlanPort(plan, port) {
  plan.port = port;
  plan.v2Url = postgresUrl({
    port,
    user: plan.user,
    password: plan.password,
    database: plan.v2Database,
  });
  plan.legacyUrl = postgresUrl({
    port,
    user: plan.user,
    password: plan.password,
    database: plan.legacyDatabase,
  });
}

function buildToolEnvironment(managedEnv, password) {
  return {
    ...managedEnv,
    PGPASSWORD: password,
    PGCONNECT_TIMEOUT: "5",
    PGSSLMODE: "disable",
    PGCLIENTENCODING: "UTF8",
  };
}

/**
 * Build a child environment that cannot fall back to a caller database URL or
 * a libpq environment variable.
 * @param {NodeJS.ProcessEnv} baseEnv
 * @param {{v2Url: string, legacyUrl: string}} plan
 * @param {NodeJS.ProcessEnv} extra
 */
export function buildManagedEnvironment(baseEnv, plan, extra = {}) {
  if (!plan?.v2Url || !plan?.legacyUrl) {
    throw new HarnessError("A database plan is required.");
  }

  const env = {};
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      upper === "DATABASE_URL" ||
      upper === "V2_DATABASE_URL" ||
      upper === "SHADOW_DATABASE_URL" ||
      upper === "DIRECT_URL" ||
      upper === MANAGED_ENV_NAME ||
      upper === "NODE_ENV" ||
      upper.startsWith("PG")
    ) {
      continue;
    }
    env[key] = value;
  }

  env.NODE_ENV = "test";
  env[MANAGED_ENV_NAME] = "1";
  env.V2_DATABASE_URL = plan.v2Url;
  env.DATABASE_URL = plan.legacyUrl;

  return { ...env, ...extra };
}

function defaultFileExists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve npm without a shell. npm_execpath is preferred; otherwise look for
 * the npm CLI next to the running node binary or on PATH.
 * @param {{env?: NodeJS.ProcessEnv, execPath?: string, fileExists?: (path: string) => boolean}} options
 * @returns {{command: string, args: string[], source: string}}
 */
export function resolveNpmInvocation({
  env = process.env,
  execPath = process.execPath,
  fileExists = defaultFileExists,
} = {}) {
  const npmExecPath = env.npm_execpath?.trim();
  if (npmExecPath) {
    if (/\.(cmd|bat)$/iu.test(npmExecPath)) {
      const jsCli = join(dirname(npmExecPath), "node_modules", "npm", "bin", "npm-cli.js");
      if (fileExists(jsCli)) {
        return { command: execPath, args: [jsCli], source: "npm_execpath" };
      }
      throw new HarnessError(
        "npm_execpath points to a Windows shim without a sibling npm-cli.js.",
      );
    }
    if (!fileExists(npmExecPath)) {
      throw new HarnessError("npm_execpath points to a file that does not exist.");
    }
    if (/\.[cm]?js$/iu.test(npmExecPath)) {
      return { command: execPath, args: [npmExecPath], source: "npm_execpath" };
    }
    return { command: npmExecPath, args: [], source: "npm_execpath" };
  }

  const nodeDir = dirname(execPath);
  const discovered = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of discovered) {
    if (fileExists(candidate)) {
      return { command: execPath, args: [candidate], source: "node-directory" };
    }
  }

  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  const pathValue = pathKey ? env[pathKey] ?? "" : "";
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const candidates = [
      join(entry, "node_modules", "npm", "bin", "npm-cli.js"),
      join(entry, "npm-cli.js"),
    ];
    for (const candidate of candidates) {
      if (fileExists(candidate)) {
        return { command: execPath, args: [candidate], source: "PATH" };
      }
    }
  }

  throw new HarnessError(
    "Cannot locate the npm CLI. Run through npm so npm_execpath is set, or set npm_execpath.",
  );
}

/** Redact passwords/URLs before anything is written to the console. */
export function redactSensitive(text, secrets = []) {
  let result = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      result = result.split(secret).join("[redacted]");
    }
  }
  result = result.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/giu, "postgresql://[redacted]");
  result = result.replace(/(PGPASSWORD=)[^\s]+/giu, "$1[redacted]");
  return result;
}

export function isPortCollisionMessage(text) {
  return /address already in use|could not bind|could not create listen socket|another postmaster|is another postmaster/iu.test(
    String(text ?? ""),
  );
}

function capOutput(text) {
  return text.length > MAX_CAPTURE_BYTES ? text.slice(-MAX_CAPTURE_BYTES) : text;
}

function tail(text, length = 4000) {
  const value = String(text ?? "");
  return value.length > length ? value.slice(-length) : value;
}

function failureDetail(result) {
  if (result.error) return result.error.message;
  if (result.timedOut) return "timed out";
  if (result.signal) return `terminated by ${result.signal}`;
  return `exit code ${result.code}`;
}

function signalExitCode(signal) {
  return 128 + (SIGNAL_NUMBERS[signal] ?? 0);
}

let activeChild = null;
let receivedSignal = null;

function terminateChild(child, force = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The child may already be gone.
  }
  if (!force) {
    const timer = setTimeout(() => terminateChild(child, true), 5000);
    timer.unref?.();
  }
}

function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (receivedSignal) return;
      receivedSignal = signal;
      if (activeChild) terminateChild(activeChild);
    });
  }
}

function throwIfInterrupted() {
  if (receivedSignal) {
    throw new HarnessError(`Interrupted by ${receivedSignal}.`);
  }
}

/**
 * Spawn without a shell. Captured output is written through inherited file
 * descriptors (not pipes, which are unavailable in some confined sandboxes)
 * and capped so a noisy command cannot consume unbounded memory.
 */
function runProcess({
  command,
  args,
  cwd,
  env,
  timeoutMs,
  capture = false,
  captureDir,
}) {
  return new Promise((resolvePromise) => {
    let stdoutFile;
    let stderrFile;
    let stdoutFd;
    let stderrFd;

    if (capture) {
      const directory = captureDir ?? tmpdir();
      const marker = randomBytes(6).toString("hex");
      stdoutFile = join(directory, `capture-${marker}.out`);
      stderrFile = join(directory, `capture-${marker}.err`);
      try {
        stdoutFd = openSync(stdoutFile, "w");
        stderrFd = openSync(stderrFile, "w");
      } catch (error) {
        closeQuietly(stdoutFd);
        closeQuietly(stderrFd);
        removeQuietly(stdoutFile);
        removeQuietly(stderrFile);
        resolvePromise({
          code: null,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          error,
        });
        return;
      }
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: capture ? ["ignore", stdoutFd, stderrFd] : "inherit",
      });
    } catch (error) {
      closeQuietly(stdoutFd);
      closeQuietly(stderrFd);
      removeQuietly(stdoutFile);
      removeQuietly(stderrFile);
      resolvePromise({
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error,
      });
      return;
    }

    // The child has inherited duplicates; the parent no longer needs these.
    closeQuietly(stdoutFd);
    closeQuietly(stderrFd);
    stdoutFd = undefined;
    stderrFd = undefined;

    activeChild = child;
    let timedOut = false;
    let settled = false;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      const stdout = capture ? readCapture(stdoutFile) : "";
      const stderr = capture ? readCapture(stderrFile) : "";
      removeQuietly(stdoutFile);
      removeQuietly(stderrFile);
      resolvePromise({ ...result, stdout, stderr, timedOut });
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminateChild(child, true);
      }, timeoutMs);
      timer.unref?.();
    }

    child.on("error", (error) => {
      finish({ code: null, signal: null, error });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, error: null });
    });
  });
}

function closeQuietly(fd) {
  if (fd === undefined || fd === null) return;
  try {
    closeSync(fd);
  } catch {
    // Already closed.
  }
}

function removeQuietly(path) {
  if (!path) return;
  try {
    unlinkSync(path);
  } catch {
    // Already removed.
  }
}

function readCapture(path) {
  if (!path) return "";
  try {
    return capOutput(readFileSync(path, "utf8"));
  } catch {
    return "";
  }
}

function toolPath(pgBin, name) {
  if (!pgBin) return name;
  const candidates =
    process.platform === "win32"
      ? [join(pgBin, `${name}.exe`), join(pgBin, name)]
      : [join(pgBin, name)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new HarnessError(
    `PG_BIN does not contain ${name}${process.platform === "win32" ? ".exe" : ""}.`,
  );
}

function resolvePgTools(env) {
  const pgBin = env.PG_BIN?.trim();
  if (pgBin && !existsSync(pgBin)) {
    throw new HarnessError("PG_BIN does not exist.");
  }
  return {
    initdb: toolPath(pgBin, "initdb"),
    pgCtl: toolPath(pgBin, "pg_ctl"),
    createdb: toolPath(pgBin, "createdb"),
    psql: toolPath(pgBin, "psql"),
  };
}

async function findAvailablePort(usedPorts) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = await new Promise((resolvePromise, rejectPromise) => {
      const server = net.createServer();
      server.once("error", rejectPromise);
      server.listen({ host: HOST, port: 0, exclusive: true }, () => {
        const address = server.address();
        const selected =
          address && typeof address === "object" ? address.port : 0;
        server.close((error) => {
          if (error) rejectPromise(error);
          else resolvePromise(selected);
        });
      });
    });
    if (
      Number.isInteger(port) &&
      port > 0 &&
      port !== DEFAULT_POSTGRES_PORT &&
      !usedPorts.has(port)
    ) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new HarnessError("Could not allocate a free loopback port.");
}

async function createClusterState(plan) {
  const tempDir = await mkdtemp(join(tmpdir(), CLUSTER_PREFIX));
  try {
    const dataDir = join(tempDir, "data");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    return {
      tempDir,
      dataDir,
      logFile: join(tempDir, "postgres.log"),
      passwordFile: join(tempDir, "initdb-password"),
      originalConfig: null,
      plan,
      port: plan.port,
      started: false,
      serverVersion: null,
      usedPorts: new Set([plan.port]),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function configureCluster(ctx) {
  if (!ctx.originalConfig) {
    ctx.originalConfig = await readFile(
      join(ctx.dataDir, "postgresql.conf"),
      "utf8",
    );
  }

  const lines = [
    ctx.originalConfig,
    "",
    "# --- wms isolated test database harness ---",
    `listen_addresses = '${HOST}'`,
    `port = ${ctx.port}`,
  ];
  if (process.platform !== "win32") {
    const socketDir = join(ctx.tempDir, "socket");
    await mkdir(socketDir, { recursive: true, mode: 0o700 });
    lines.push(
      `unix_socket_directories = '${socketDir.replaceAll("\\", "/").replaceAll("'", "''")}'`,
    );
  }
  lines.push("");

  await writeFile(join(ctx.dataDir, "postgresql.conf"), lines.join("\n"), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readLogTail(ctx) {
  try {
    return tail(await readFile(ctx.logFile, "utf8"));
  } catch {
    return "";
  }
}

async function pgStatus(ctx, pg, env) {
  if (!existsSync(ctx.dataDir)) {
    return { code: 3, signal: null, stdout: "", stderr: "", timedOut: false, error: null };
  }
  return runProcess({
    command: pg.pgCtl,
    args: ["-D", ctx.dataDir, "status"],
    cwd: ctx.tempDir,
    env,
    timeoutMs: 15_000,
    capture: true,
    captureDir: ctx.tempDir,
  });
}

async function startCluster({ ctx, pg, env, redact }) {
  for (let attempt = 1; attempt <= PORT_START_ATTEMPTS; attempt += 1) {
    throwIfInterrupted();
    if (attempt > 1) {
      ctx.port = await findAvailablePort(ctx.usedPorts);
      setPlanPort(ctx.plan, ctx.port);
    }
    await configureCluster(ctx);

    const result = await runProcess({
      command: pg.pgCtl,
      args: [
        "-D",
        ctx.dataDir,
        "-l",
        ctx.logFile,
        "-w",
        "-t",
        "60",
        "start",
      ],
      cwd: ctx.tempDir,
      env,
      timeoutMs: PG_START_TIMEOUT_MS,
      capture: true,
      captureDir: ctx.tempDir,
    });

    if (result.code === 0) {
      ctx.started = true;
      return;
    }

    const status = await pgStatus(ctx, pg, env);
    if (status.code === 0) {
      ctx.started = true;
      throw new HarnessError(
        `pg_ctl reported failure (${failureDetail(result)}) but the owned server is running.`,
      );
    }

    const log = await readLogTail(ctx);
    const combined = `${result.stdout}\n${result.stderr}\n${log}`;
    if (isPortCollisionMessage(combined) && attempt < PORT_START_ATTEMPTS) {
      continue;
    }
    throw new HarnessError(
      `pg_ctl start failed (${failureDetail(result)}): ${redact(tail(combined))}`,
    );
  }

  throw new HarnessError("Could not start the owned PostgreSQL cluster.");
}

function normalizeComparisonPath(path) {
  const normalized = resolve(path).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function waitForReady({ ctx, pg, env, redact }) {
  const query =
    "SELECT current_setting('data_directory'), inet_server_port(), current_setting('server_version')";
  let lastError = "";
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    throwIfInterrupted();
    const result = await runProcess({
      command: pg.psql,
      args: [
        "-h",
        HOST,
        "-p",
        String(ctx.port),
        "-U",
        ctx.plan.user,
        "-d",
        "postgres",
        "-w",
        "-A",
        "-t",
        "-q",
        "-c",
        query,
      ],
      cwd: ctx.tempDir,
      env,
      timeoutMs: 10_000,
      capture: true,
      captureDir: ctx.tempDir,
    });

    if (result.code === 0) {
      const [dataDirectory, portText, version] = result.stdout.trim().split("|");
      if (
        dataDirectory &&
        normalizeComparisonPath(dataDirectory) ===
          normalizeComparisonPath(ctx.dataDir) &&
        Number(portText) === ctx.port
      ) {
        ctx.serverVersion = version || "unknown";
        return;
      }
      lastError = "readiness query did not identify the owned cluster";
    } else {
      lastError = redact(
        tail(`${result.stdout}\n${result.stderr}`.trim()) ||
          failureDetail(result),
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new HarnessError(
    `The owned PostgreSQL cluster did not become ready on ${HOST}:${ctx.port}: ${lastError}`,
  );
}

async function runProvisioningCommand({
  label,
  command,
  args,
  cwd,
  env,
  timeoutMs,
  redact,
  captureDir,
}) {
  throwIfInterrupted();
  const result = await runProcess({
    command,
    args,
    cwd,
    env,
    timeoutMs,
    capture: true,
    captureDir,
  });

  if (result.code !== 0) {
    const output = redact(tail(`${result.stdout}\n${result.stderr}`.trim()));
    let detail = failureDetail(result);
    if (result.error?.code === "ENOENT") {
      detail =
        "PostgreSQL client tools were not found. Add them to PATH or set PG_BIN.";
    }
    throw new HarnessError(
      `${label} failed (${detail})${output ? `:\n${output}` : "."}`,
    );
  }

  return result;
}

async function createDatabases({ ctx, pg, env, redact }) {
  for (const database of [ctx.plan.v2Database, ctx.plan.legacyDatabase]) {
    await runProvisioningCommand({
      label: `createdb ${database}`,
      command: pg.createdb,
      args: [
        "-h",
        HOST,
        "-p",
        String(ctx.port),
        "-U",
        ctx.plan.user,
        "-w",
        database,
      ],
      cwd: ctx.tempDir,
      env,
      timeoutMs: 60_000,
      redact,
      captureDir: ctx.tempDir,
    });
  }
}

async function runNpmScript({ npm, script, env, cwd, redact, captureDir }) {
  await runProvisioningCommand({
    label: `npm run ${script}`,
    command: npm.command,
    args: [...npm.args, "run", script],
    cwd,
    env,
    timeoutMs: PROVISION_TIMEOUT_MS,
    redact,
    captureDir,
  });
}

async function provisionCluster({ ctx, pg, npm, legacy, redact }) {
  // This environment is only used before the final port is known. PostgreSQL
  // client tools below use PGPASSWORD and explicit -h/-p arguments, so the
  // URL values here are irrelevant until the final environment is rebuilt.
  const initialEnv = buildToolEnvironment(
    buildManagedEnvironment(process.env, ctx.plan),
    ctx.plan.password,
  );

  try {
    await writeFile(ctx.passwordFile, `${ctx.plan.password}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await runProvisioningCommand({
      label: "initdb",
      command: pg.initdb,
      args: [
        "-D",
        ctx.dataDir,
        "-U",
        ctx.plan.user,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--no-locale",
        "--pwfile",
        ctx.passwordFile,
      ],
      cwd: ctx.tempDir,
      env: initialEnv,
      timeoutMs: INITDB_TIMEOUT_MS,
      redact,
      captureDir: ctx.tempDir,
    });
  } finally {
    await rm(ctx.passwordFile, { force: true }).catch(() => {});
  }

  await startCluster({ ctx, pg, env: initialEnv, redact });
  await waitForReady({ ctx, pg, env: initialEnv, redact });

  // A port collision may have moved the cluster during start, so rebuild the
  // URLs now that ctx.port is final.
  const managedEnv = buildManagedEnvironment(process.env, ctx.plan);
  const provisionEnv = buildToolEnvironment(managedEnv, ctx.plan.password);

  await createDatabases({ ctx, pg, env: provisionEnv, redact });

  for (const script of MIGRATION_SCRIPTS) {
    await runNpmScript({
      npm,
      script,
      env: provisionEnv,
      cwd: PROJECT_ROOT,
      redact,
      captureDir: ctx.tempDir,
    });
  }

  if (legacy) {
    // The legacy test:all path writes to DATABASE_URL. Prepare the synthetic
    // database from the current V1 schema (not the historical migration chain)
    // without force-resetting anything.
    await runProvisioningCommand({
      label: "legacy Prisma db push",
      command: process.execPath,
      args: [
        join("node_modules", "prisma", "build", "index.js"),
        "db",
        "push",
        "--config",
        "prisma.config.ts",
      ],
      cwd: PROJECT_ROOT,
      env: provisionEnv,
      timeoutMs: PROVISION_TIMEOUT_MS,
      redact,
      captureDir: ctx.tempDir,
    });
  }

  return { managedEnv, provisionEnv };
}

/**
 * Stop the owned server and remove the owned mkdtemp directory. A directory is
 * never removed while the server is still running.
 */
async function cleanupCluster({ ctx, pg, env, redact }) {
  const errors = [];
  if (!ctx) return errors;

  const status = await pgStatus(ctx, pg, env);
  if (status.code === 0) {
    const stop = await runProcess({
      command: pg.pgCtl,
      args: ["-D", ctx.dataDir, "-m", "fast", "-w", "-t", "60", "stop"],
      cwd: ctx.tempDir,
      env,
      timeoutMs: PG_STOP_TIMEOUT_MS,
      capture: true,
      captureDir: ctx.tempDir,
    });
    if (stop.code !== 0) {
      errors.push(
        `pg_ctl stop failed (${failureDetail(stop)})${redact(
          tail(`${stop.stdout}\n${stop.stderr}`.trim()),
        ) ? `: ${redact(tail(`${stop.stdout}\n${stop.stderr}`.trim()))}` : "."}`,
      );
    }
    const after = await pgStatus(ctx, pg, env);
    if (after.code === 0) {
      errors.push(
        `PostgreSQL is still running for the owned cluster; leaving ${ctx.tempDir} in place.`,
      );
      return errors;
    }
    if (after.code !== 3) {
      errors.push(
        `Could not confirm the owned PostgreSQL cluster stopped (${failureDetail(
          after,
        )}); leaving ${ctx.tempDir} in place.`,
      );
      return errors;
    }
  } else if (status.code !== 3) {
    errors.push(
      `Could not determine owned PostgreSQL status (${failureDetail(
        status,
      )}); leaving ${ctx.tempDir} in place.`,
    );
    return errors;
  }

  if (!basename(ctx.tempDir).startsWith(CLUSTER_PREFIX)) {
    errors.push(`Refusing to remove unexpected directory ${ctx.tempDir}.`);
    return errors;
  }

  try {
    await rm(ctx.tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    errors.push(
      `Could not remove owned cluster directory ${ctx.tempDir}: ${redact(
        error.message,
      )}`,
    );
  }

  return errors;
}

async function runCallback({ parsed, npm, env }) {
  const command = parsed.runner === "node" ? process.execPath : npm.command;
  const args =
    parsed.runner === "node" ? parsed.args : [...npm.args, ...parsed.args];

  return runProcess({
    command,
    args,
    cwd: process.cwd(),
    env,
    timeoutMs: 0,
    capture: false,
  });
}

function printCleanupErrors(errors) {
  for (const error of errors) {
    console.error(`[wms-test-db] cleanup: ${error}`);
  }
}

/**
 * Run the harness and resolve with the process exit code. Exported so tests can
 * drive the exact entrypoint path through a wrapper process (for example to
 * verify interrupt handling) without duplicating the CLI logic.
 * @param {string[]} [argv] defaults to process.argv.slice(2)
 */
export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(`[wms-test-db] ${error.message}`);
    console.error(USAGE);
    return error.exitCode ?? 2;
  }

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }

  installSignalHandlers();

  let ctx = null;
  let pg = null;
  let npm = null;
  let environments = null;
  let failure = null;
  let callbackResult = null;
  let cleanupErrors = [];
  let redact = (text) => redactSensitive(text);

  try {
    npm = resolveNpmInvocation();
    pg = resolvePgTools(process.env);

    const usedPorts = new Set();
    const port = await findAvailablePort(usedPorts);
    const plan = buildDatabasePlan({ port });
    redact = (text) => redactSensitive(text, [plan.password]);

    ctx = await createClusterState(plan);
    environments = await provisionCluster({
      ctx,
      pg,
      npm,
      legacy: parsed.legacy,
      redact,
    });

    throwIfInterrupted();
    console.error(
      `[wms-test-db] ready: PostgreSQL ${ctx.serverVersion} on ${HOST}:${ctx.port}; database ${plan.v2Database}`,
    );
    callbackResult = await runCallback({
      parsed,
      npm,
      env: environments.managedEnv,
    });
  } catch (error) {
    failure = error;
  } finally {
    cleanupErrors = await cleanupCluster({
      ctx,
      pg,
      env: environments?.provisionEnv ?? process.env,
      redact,
    }).catch((error) => [
      `Unexpected cleanup failure: ${redact(error.message)}`,
    ]);
  }

  printCleanupErrors(cleanupErrors);

  if (failure) {
    const code = receivedSignal
      ? signalExitCode(receivedSignal)
      : failure.exitCode ?? 1;
    console.error(
      `[wms-test-db] ${redact(failure.message || String(failure))}`,
    );
    return code;
  }

  if (receivedSignal) {
    return signalExitCode(receivedSignal);
  }

  if (cleanupErrors.length > 0) {
    return 1;
  }

  if (callbackResult?.error) {
    console.error(
      `[wms-test-db] callback failed to start: ${redact(callbackResult.error.message)}`,
    );
    return 1;
  }
  if (callbackResult?.timedOut) {
    console.error("[wms-test-db] callback timed out.");
    return 1;
  }
  if (callbackResult?.signal) {
    return signalExitCode(callbackResult.signal);
  }

  return callbackResult?.code ?? 1;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const invoked = resolve(process.argv[1]);
  return process.platform === "win32"
    ? self.toLowerCase() === invoked.toLowerCase()
    : self === invoked;
}

if (isEntryPoint()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[wms-test-db] ${redactSensitive(error.message || String(error))}`);
      process.exitCode = 1;
    });
}
