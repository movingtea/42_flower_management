import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-v2/client";
import { runProductionBootstrap } from "../../prisma/v2/seed/production";
import {
  KNOWN_DEFAULT_PASSWORD_CANDIDATES,
  V2_BOOTSTRAP_PASSWORD_MIN_LENGTH,
  V2_STAFF_RESET_PASSWORD_MIN_LENGTH,
  isStrongV2Password,
} from "./password-policy";

/**
 * E3.5 credential governance contract tests.
 *
 * Discovered by `npm run test:integration:v2` (src/v2/**\/*.test.ts). Pure
 * checks always run; the database-backed checks run under the managed test
 * database harness and cover the production seed rejection matrix and the
 * credential-governance startup check. Nothing here prints a password, a hash, a
 * password-file path or a database URL.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const TSX_CLI = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const STARTUP_CHECK = join(
  PROJECT_ROOT,
  "scripts",
  "check-v2-credential-governance.mjs",
);
const SEED_ENTRY = "prisma/v2/seed.ts";

type CliResult = { status: number | null; output: string };
type CliEnv = Record<string, string | undefined>;

function runCli(
  args: string[],
  env: CliEnv,
  timeoutMs = 180_000,
): CliResult {
  const directory = mkdtempSync(join(tmpdir(), "e35-cli-"));
  const stdoutPath = join(directory, "stdout.log");
  const stderrPath = join(directory, "stderr.log");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const result = (() => {
    try {
      return spawnSync(process.execPath, args, {
        cwd: PROJECT_ROOT,
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", stdoutFd, stderrFd],
        timeout: timeoutMs,
        windowsHide: true,
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
  })();
  try {
    return {
      status: result.status,
      output: `${readFileSync(stdoutPath, "utf8")}\n${readFileSync(stderrPath, "utf8")}`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runSeed(args: string[], env: CliEnv): CliResult {
  return runCli([TSX_CLI, SEED_ENTRY, ...args], {
    ...process.env,
    ...env,
    NODE_ENV: "test",
  });
}

function assertNoSensitiveOutput(output: string, secrets: readonly string[]): void {
  assert.equal(/postgres(?:ql)?:\/\//iu.test(output), false, "output must not contain a database URL");
  assert.equal(/\$2[aby]\$/u.test(output), false, "output must not contain a bcrypt hash");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      assert.equal(output.includes(secret), false, "output must not contain a supplied secret");
    }
  }
}

type StartupCheckEvent = {
  event: string;
  fields: { outcome: string; findings: string[] };
};

function lastStartupCheckEvent(output: string): StartupCheckEvent {
  const line = output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("{"))
    .at(-1);
  assert.ok(line, "the startup check must emit one JSON event line");
  const parsed = JSON.parse(line) as StartupCheckEvent;
  assert.equal(parsed.event, "security.startup.check");
  assert.ok(Array.isArray(parsed.fields.findings));
  return parsed;
}

function seedEnv(
  connectionString: string,
  overrides: CliEnv,
): CliEnv {
  return { V2_DATABASE_URL: connectionString, ...overrides };
}

/**
 * The production bootstrap race fallback must mark a row created through
 * `upsert.create` as a first-login account. The race window itself is not
 * reproducible deterministically, so the aggregate is exercised with a fake
 * transaction client.
 */
async function raceFallbackContract(): Promise<void> {
  let capturedCreate: Record<string, unknown> | undefined;
  let capturedUpdate: Record<string, unknown> | undefined;
  const fakeTx = {
    tenant: {
      upsert: async () => ({ id: "tenant-1", slug: "default", name: "tenant" }),
    },
    store: {
      upsert: async () => ({ id: "store-1", code: "MAIN", name: "store" }),
    },
    inventoryLocation: {
      upsert: async (args: { where: { storeId_code: { code: string } } }) => ({
        id: `location-${args.where.storeId_code.code}`,
        code: args.where.storeId_code.code,
      }),
    },
    storeSettings: { upsert: async () => ({}) },
    staffUser: {
      createMany: async () => ({ count: 1 }),
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        capturedCreate = args.create;
        capturedUpdate = args.update;
        return { id: "staff-1" };
      },
    },
    tenantMember: { upsert: async () => ({}) },
    storeMember: { upsert: async () => ({}) },
  };
  const fakeClient = {
    $transaction: async (callback: (tx: typeof fakeTx) => Promise<void>) => callback(fakeTx),
  };
  const seeded = await runProductionBootstrap(fakeClient as never, {
    username: "admin",
    passwordHash: "hashed",
  });
  assert.equal(seeded, true);
  assert.ok(capturedCreate, "the upsert create branch must run");
  assert.equal(capturedCreate.mustChangePassword, true);
  assert.deepEqual(capturedUpdate, {}, "existing rows must never be overwritten");
}

function passwordPolicyContract(): void {
  assert.equal(V2_BOOTSTRAP_PASSWORD_MIN_LENGTH, 16);
  assert.equal(V2_STAFF_RESET_PASSWORD_MIN_LENGTH, 8);
  assert.ok(isStrongV2Password("StrongBootstrapPass!42", "e35init"));
  assert.equal(isStrongV2Password("short", "e35init"), false);

  // Keep the startup-check candidate list in sync with the policy module.
  const listing = runCli([STARTUP_CHECK, "--list-default-candidates"], {
    ...process.env,
    V2_DATABASE_URL: "",
    DATABASE_URL: "",
    NODE_ENV: "test",
  });
  assert.equal(listing.status, 0);
  const line = listing.output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("["))
    .at(-1);
  assert.ok(line, "the startup check must print its candidate list");
  assert.deepEqual(JSON.parse(line), [...KNOWN_DEFAULT_PASSWORD_CANDIDATES]);
}

async function deleteStaff(db: PrismaClient, staffId: string): Promise<void> {
  await db.storeMember.deleteMany({ where: { staffUserId: staffId } });
  await db.tenantMember.deleteMany({ where: { staffUserId: staffId } });
  await db.staffUser.deleteMany({ where: { id: staffId } });
}

async function staffStateDigest(db: PrismaClient): Promise<string> {
  const rows = await db.staffUser.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      active: true,
      mustChangePassword: true,
    },
  });
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function startupCheckMatrix(
  db: PrismaClient,
  connectionString: string,
): Promise<void> {
  const url = new URL(connectionString);
  const secrets = [connectionString, decodeURIComponent(url.password)];
  const baseEnv = {
    ...process.env,
    NODE_ENV: "test",
    V2_DATABASE_URL: connectionString,
  };
  const digestBefore = await staffStateDigest(db);

  // Scenario 1: known default credentials in the managed test seed -> warn, exit 0.
  let result = runCli([STARTUP_CHECK], {
    ...baseEnv,
    V2_CREDENTIAL_CHECK_MODE: "warn",
  });
  assert.equal(result.status, 0, "warn mode must exit 0");
  let event = lastStartupCheckEvent(result.output);
  assert.equal(event.fields.outcome, "warn");
  assert.ok(
    event.fields.findings.some((finding) => finding.startsWith("v2_known_default_password:")),
    "warn mode must report a known default V2 password",
  );
  assertNoSensitiveOutput(result.output, secrets);
  assert.ok(!result.output.includes("admin/admin"), "output must not echo default credentials");
  console.log("[e35] startup check: warn mode on the default-credential fixture -> exit 0, v2_known_default_password reported");

  // Scenario 2: same findings in block mode -> non-zero exit.
  result = runCli([STARTUP_CHECK], {
    ...baseEnv,
    V2_CREDENTIAL_CHECK_MODE: "block",
  });
  assert.equal(result.status, 1, "block mode must fail the startup check");
  event = lastStartupCheckEvent(result.output);
  assert.equal(event.fields.outcome, "blocked");
  assertNoSensitiveOutput(result.output, secrets);
  console.log("[e35] startup check: block mode -> exit 1, outcome blocked");

  // Scenario 3: an active account that still needs its first password change.
  const pendingUsername = `e35pending-${randomUUID().slice(0, 8)}`;
  const pendingHash = await bcrypt.hash("PendingBootstrapPass!42", 10);
  const pending = await db.staffUser.create({
    data: { username: pendingUsername, passwordHash: pendingHash, mustChangePassword: true },
  });
  try {
    result = runCli([STARTUP_CHECK], {
      ...baseEnv,
      DATABASE_URL: "",
      V2_CREDENTIAL_CHECK_MODE: "warn",
    });
    assert.equal(result.status, 0);
    event = lastStartupCheckEvent(result.output);
    assert.equal(event.fields.outcome, "warn");
    assert.ok(
      event.fields.findings.includes(`v2_bootstrap_pending:${pending.id}`),
      "an unfinished bootstrap account must be reported",
    );
    assertNoSensitiveOutput(result.output, secrets);
    assert.ok(
      !event.fields.findings.includes(`v2_known_default_password:${pending.id}`),
      "a strong bootstrap password must not be reported as a default",
    );
    console.log("[e35] startup check: unfinished bootstrap account flagged as v2_bootstrap_pending, strong hash not flagged as default");
  } finally {
    await deleteStaff(db, pending.id);
  }

  // Scenario 4: clean active set -> ok, exit 0. The no-DATABASE_URL variants
  // also prove the V1 hint is optional.
  const active = await db.staffUser.findMany({ where: { active: true }, select: { id: true } });
  try {
    if (active.length > 0) {
      await db.staffUser.updateMany({
        where: { id: { in: active.map((row) => row.id) } },
        data: { active: false },
      });
    }
    result = runCli([STARTUP_CHECK], {
      ...baseEnv,
      DATABASE_URL: "",
      V2_CREDENTIAL_CHECK_MODE: "warn",
    });
    assert.equal(result.status, 0);
    event = lastStartupCheckEvent(result.output);
    assert.equal(event.fields.outcome, "ok");
    assert.deepEqual(event.fields.findings, []);
    assertNoSensitiveOutput(result.output, secrets);
    console.log("[e35] startup check: clean fixture -> outcome ok, exit 0");
  } finally {
    if (active.length > 0) {
      await db.staffUser.updateMany({
        where: { id: { in: active.map((row) => row.id) } },
        data: { active: true },
      });
    }
  }

  // The check is read-only: the persisted credential state must be unchanged.
  assert.equal(await staffStateDigest(db), digestBefore, "the startup check must not modify accounts");
  console.log("[e35] startup check: account state digest unchanged (read-only)");
}

async function seedRejectionMatrix(
  db: PrismaClient,
  connectionString: string,
): Promise<void> {
  const marker = randomUUID().slice(0, 8);
  const scratch = mkdtempSync(join(tmpdir(), "e35-seed-"));
  const url = new URL(connectionString);
  const dbPassword = decodeURIComponent(url.password);
  let createdStaffId: string | null = null;
  try {
    // 1. Missing password file: fixed error, no path.
    const missingFile = join(scratch, "missing-password-file");
    let result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: `e35missing${marker}`,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: missingFile,
    }));
    assert.equal(result.status, 1, "a missing password file must fail production seed");
    assert.match(result.output, /Unable to read the V2 bootstrap password file/u);
    assert.equal(result.output.includes(missingFile), false, "the error must not contain the password file path");
    assertNoSensitiveOutput(result.output, [dbPassword]);
    console.log("[e35] production seed: missing password file -> exit 1, fixed message, no path");

    // 2. Weak password: rejected without echoing the password.
    const weakFile = join(scratch, "weak-password");
    await writeFile(weakFile, "short\n", "utf8");
    result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: `e35weak${marker}`,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: weakFile,
    }));
    assert.equal(result.status, 1, "a weak bootstrap password must fail production seed");
    assert.match(result.output, /does not meet the V2 password policy/u);
    assert.equal(result.output.includes("short"), false, "the error must not contain the password");
    assertNoSensitiveOutput(result.output, [dbPassword]);
    console.log("[e35] production seed: weak password -> exit 1, no password echoed");

    // 3. Default credential shape (password repeats the username): rejected.
    const defaultUsername = `e35default${marker}`;
    const defaultFile = join(scratch, "default-password");
    await writeFile(defaultFile, `${defaultUsername}xxxx\n`, "utf8");
    result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: defaultUsername,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: defaultFile,
    }));
    assert.equal(result.status, 1, "a default-credential shape must fail production seed");
    assert.match(result.output, /does not meet the V2 password policy/u);
    assert.equal(result.output.includes(`${defaultUsername}xxxx`), false);
    assertNoSensitiveOutput(result.output, [dbPassword]);
    console.log("[e35] production seed: default-credential shape -> exit 1");

    // 4. Test tier flag is rejected in production mode.
    result = runSeed(["production", "--tiers=minimum"], seedEnv(connectionString, {}));
    assert.equal(result.status, 1, "production mode must reject --tiers");
    assert.match(result.output, /production 模式不接受 --tiers/u);
    assertNoSensitiveOutput(result.output, [dbPassword]);
    console.log("[e35] production seed: --tiers in production -> exit 1");

    // 5. V1 and V2 must never target the same database.
    result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: `e35same${marker}`,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: join(scratch, "unused"),
      DATABASE_URL: connectionString,
    }));
    assert.equal(result.status, 1, "shared V1/V2 database names must fail production seed");
    assert.match(result.output, /distinct PostgreSQL database names/u);
    assertNoSensitiveOutput(result.output, [dbPassword]);
    console.log("[e35] production seed: shared V1/V2 database name -> exit 1");

    // 6. Positive path: a strong password bootstraps a must-change admin.
    const initUsername = `e35init${marker}`;
    const strongFile = join(scratch, "strong-password");
    const strongPassword = "StrongBootstrapPass!42";
    await writeFile(strongFile, `${strongPassword}\n`, "utf8");
    result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: initUsername,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: strongFile,
    }));
    assert.equal(result.status, 0, "a strong bootstrap password must seed successfully");
    assertNoSensitiveOutput(result.output, [dbPassword, strongPassword]);

    const staff = await db.staffUser.findUnique({ where: { username: initUsername } });
    assert.ok(staff, "the bootstrap admin must be created");
    createdStaffId = staff.id;
    assert.equal(staff.mustChangePassword, true, "a production bootstrap admin must change the password");
    assert.equal(staff.active, true);
    assert.ok(await bcrypt.compare(strongPassword, staff.passwordHash));
    const tenantMember = await db.tenantMember.findFirst({
      where: { staffUserId: staff.id, active: true },
    });
    const storeMember = await db.storeMember.findFirst({
      where: { staffUserId: staff.id, active: true },
    });
    assert.ok(tenantMember && tenantMember.roles.includes("ADMIN"));
    assert.ok(storeMember && storeMember.roles.includes("ADMIN"));

    // Re-running keeps the existing credentials ("already exists, not overwritten").
    const firstHash = staff.passwordHash;
    result = runSeed(["production"], seedEnv(connectionString, {
      V2_BOOTSTRAP_ADMIN_USERNAME: initUsername,
      V2_BOOTSTRAP_ADMIN_PASSWORD_FILE: strongFile,
    }));
    assert.equal(result.status, 0, "an existing bootstrap username must be a no-op");
    assert.match(result.output, /Bootstrap username already exists/u);
    const again = await db.staffUser.findUnique({ where: { id: staff.id } });
    assert.equal(again?.passwordHash, firstHash, "existing credentials must be preserved");
    console.log("[e35] production seed: strong bootstrap -> exit 0, mustChangePassword=true, administrator-role memberships, no-overwrite re-run preserved credentials");
  } finally {
    if (createdStaffId) await deleteStaff(db, createdStaffId);
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function productionBootstrapRaceMatrix(db: PrismaClient): Promise<void> {
  const username = `e35bootstrap-${randomUUID().slice(0, 8)}`;
  let staffId: string | null = null;
  try {
    const firstHash = await bcrypt.hash("BootstrapPassA!2345", 10);
    const first = await runProductionBootstrap(db, { username, passwordHash: firstHash });
    assert.equal(first, true);
    const staff = await db.staffUser.findUnique({ where: { username } });
    assert.ok(staff);
    staffId = staff.id;
    assert.equal(staff.mustChangePassword, true);
    assert.equal(staff.passwordHash, firstHash);

    const secondHash = await bcrypt.hash("BootstrapPassB!2345", 10);
    const second = await runProductionBootstrap(db, { username, passwordHash: secondHash });
    assert.equal(second, false, "an existing bootstrap user must not be seeded twice");
    const after = await db.staffUser.findUnique({ where: { id: staff.id } });
    assert.equal(after?.passwordHash, firstHash, "a re-run must not overwrite existing credentials");
    assert.equal(after?.mustChangePassword, true);
  } finally {
    if (staffId) await deleteStaff(db, staffId);
  }
}

async function main(): Promise<void> {
  passwordPolicyContract();
  await raceFallbackContract();

  const connectionString = process.env.V2_DATABASE_URL;
  const requireDb = process.env.WMS_TEST_DB_MANAGED === "1";
  if (!connectionString) {
    if (requireDb) throw new Error("V2_DATABASE_URL is required under the managed test database");
    console.log("credential governance pure tests passed (no database URL supplied)");
    return;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await db.$queryRaw`SELECT 1`;
    await startupCheckMatrix(db, connectionString);
    console.log(
      "[e35] startup check matrix passed: warn(default credentials)=0, block=1, unfinished-bootstrap warning, clean=ok, read-only state unchanged",
    );
    await seedRejectionMatrix(db, connectionString);
    console.log(
      "[e35] production seed matrix passed: missing-file, weak-password, default-credential shape, test-tier, shared V1/V2 database, strong bootstrap + no-overwrite re-run",
    );
    await productionBootstrapRaceMatrix(db);
    console.log(
      "[e35] production bootstrap race fallback passed: create branch marks mustChangePassword, existing rows preserved",
    );
  } finally {
    await db.$disconnect();
  }
  console.log("credential governance integration tests passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (`${error.name}: ${error.message}`) : String(error));
  process.exitCode = 1;
});


