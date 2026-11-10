#!/usr/bin/env node
/**
 * Sprint E3.5 read-only credential-governance startup check.
 *
 * Run by docker-entrypoint.sh after the database migrations. The check only
 * reads data: it never changes an account, a password or a membership.
 *
 * Strategy (approved default):
 *   V2_CREDENTIAL_CHECK_MODE=warn  (default) -> high-severity warning, exit 0
 *   V2_CREDENTIAL_CHECK_MODE=block          -> exit non-zero (refuse to start)
 *
 * Checks:
 *   1. Active V2 `StaffUser` rows whose bcrypt hash matches a small list of
 *      well-known default passwords or their own username (e.g. test seeds such
 *      as admin/admin). Hashes and plaintext candidates are never printed.
 *   2. Active V2 `StaffUser` rows that still require a first-login change
 *      (`mustChangePassword = true`), i.e. an unfinished bootstrap.
 *   3. Legacy V1 `staff_users` row `admin` with the default `admin` password
 *      (recorded as a legacy risk only; V1 is not changed by this check).
 *
 * Safety:
 *   - Read-only. No `UPDATE`/`DELETE`/inserts.
 *   - Errors and log lines never contain the connection string, a password
 *     file path, a password hash or a plaintext password.
 *   - Bounded work: at most MAX_ACTIVE_STAFF_SCANNED active accounts are
 *     compared, with limited bcrypt concurrency.
 *
 * Environment:
 *   V2_DATABASE_URL              required for the V2 checks
 *   DATABASE_URL                 optional; enables the V1 legacy hint
 *   V2_CREDENTIAL_CHECK_MODE     warn | block (default warn)
 *
 * Extra flag:
 *   --list-default-candidates    print the known-default candidate list as JSON
 *                                and exit (kept in sync with
 *                                src/v2/password-policy.ts by a test)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";

const EVENT_NAME = "security.startup.check";
const SERVICE_NAME = "flower-wms";
const CHECK_MODES = ["warn", "block"];
const MAX_ACTIVE_STAFF_SCANNED = 100;
const BCRYPT_CONCURRENCY = 4;
const CONNECT_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 15000;

/** Keep in sync with KNOWN_DEFAULT_PASSWORD_CANDIDATES in src/v2/password-policy.ts. */
const KNOWN_DEFAULT_PASSWORD_CANDIDATES = [
  "admin",
  "password",
  "123456",
  "12345678",
  "admin123",
  "flower",
  "flower123",
  "changeme",
];

function readMode() {
  const raw = (process.env.V2_CREDENTIAL_CHECK_MODE ?? "warn").trim().toLowerCase();
  if (raw === "") return { mode: "warn" };
  if (!CHECK_MODES.includes(raw)) {
    return { mode: null, error: "V2_CREDENTIAL_CHECK_MODE must be warn or block" };
  }
  return { mode: raw };
}

function safeErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/u.test(code)
    ? code
    : "unknown";
}

function logRecord(outcome, findings) {
  const record = {
    v: 1,
    ts: new Date().toISOString(),
    level: outcome === "ok" ? "info" : "warn",
    event: EVENT_NAME,
    service: SERVICE_NAME,
    env: process.env.NODE_ENV || process.env.APP_ENV || "unknown",
    fields: { outcome, findings },
  };
  const line = JSON.stringify(record);
  if (outcome === "blocked") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function candidatesFor(username) {
  return unique([username, username.toLowerCase(), ...KNOWN_DEFAULT_PASSWORD_CANDIDATES]);
}

async function findDefaultPassword(staff) {
  for (const candidate of candidatesFor(staff.username)) {
    try {
      if (await bcrypt.compare(candidate, staff.passwordHash)) return true;
    } catch {
      // A malformed hash cannot match any candidate; ignore this account.
      return false;
    }
  }
  return false;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

async function connect(url) {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

async function checkV2(findings) {
  const url = process.env.V2_DATABASE_URL;
  if (!url) {
    findings.push("v2_check_unavailable:missing_configuration");
    return;
  }
  let client;
  try {
    client = await connect(url);
  } catch (error) {
    findings.push(`v2_check_unavailable:${safeErrorCode(error)}`);
    return;
  }
  try {
    const result = await client.query(
      'SELECT id, username, "passwordHash", "mustChangePassword" FROM "StaffUser" WHERE active = true ORDER BY id LIMIT $1',
      [MAX_ACTIVE_STAFF_SCANNED + 1],
    );
    const rows = result.rows;
    if (rows.length > MAX_ACTIVE_STAFF_SCANNED) {
      findings.push("v2_check_truncated");
      rows.length = MAX_ACTIVE_STAFF_SCANNED;
    }
    const staff = rows.map((row) => ({
      id: String(row.id),
      username: String(row.username),
      passwordHash: String(row.passwordHash),
      mustChangePassword: row.mustChangePassword === true,
    }));

    const matches = await mapWithConcurrency(staff, BCRYPT_CONCURRENCY, findDefaultPassword);
    staff.forEach((row, index) => {
      if (matches[index]) findings.push(`v2_known_default_password:${row.id}`);
      if (row.mustChangePassword) findings.push(`v2_bootstrap_pending:${row.id}`);
    });
  } catch (error) {
    findings.push(`v2_check_unavailable:${safeErrorCode(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkLegacy(findings) {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  let client;
  try {
    client = await connect(url);
  } catch (error) {
    findings.push(`legacy_check_unavailable:${safeErrorCode(error)}`);
    return;
  }
  try {
    const result = await client.query(
      'SELECT "password_hash", "is_active" FROM "staff_users" WHERE lower("username") = $1 LIMIT 1',
      ["admin"],
    );
    const row = result.rows[0];
    if (row && row.is_active === true && (await bcrypt.compare("admin", String(row.password_hash)))) {
      findings.push("legacy_default_admin_password");
    }
  } catch (error) {
    findings.push(`legacy_check_unavailable:${safeErrorCode(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main(argv) {
  if (argv.includes("--list-default-candidates")) {
    process.stdout.write(`${JSON.stringify(KNOWN_DEFAULT_PASSWORD_CANDIDATES)}\n`);
    return 0;
  }

  const { mode, error } = readMode();
  if (error) {
    process.stderr.write(`[credential-check] ${error}\n`);
    return 2;
  }

  const findings = [];
  await checkV2(findings);
  await checkLegacy(findings);

  const outcome = findings.length === 0 ? "ok" : mode === "block" ? "blocked" : "warn";
  logRecord(outcome, findings);
  return outcome === "blocked" ? 1 : 0;
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
