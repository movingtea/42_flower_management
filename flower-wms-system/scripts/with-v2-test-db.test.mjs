import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  buildDatabasePlan,
  buildManagedEnvironment,
  isPortCollisionMessage,
  parseCliArgs,
  redactSensitive,
  resolveNpmInvocation,
  TEST_DB_NAME_PATTERN,
} from "./with-v2-test-db.mjs";

const HEX = "0123456789abcdef0123456789abcdef";
const PASSWORD = "per-run-password-0123456789";

function makePlan(overrides = {}) {
  return buildDatabasePlan({
    port: 55432,
    hex: HEX,
    user: "wms_owner_test",
    password: PASSWORD,
    ...overrides,
  });
}

test("parses a node callback after --", () => {
  const parsed = parseCliArgs([
    "--",
    "node",
    "-e",
    "console.log(process.env.WMS_TEST_DB_MANAGED)",
    "extra",
  ]);
  assert.equal(parsed.help, false);
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.runner, "node");
  assert.deepEqual(parsed.args, [
    "-e",
    "console.log(process.env.WMS_TEST_DB_MANAGED)",
    "extra",
  ]);
});

test("parses an npm callback after --", () => {
  const parsed = parseCliArgs(["--", "npm", "run", "test:datetime"]);
  assert.equal(parsed.legacy, false);
  assert.equal(parsed.runner, "npm");
  assert.deepEqual(parsed.args, ["run", "test:datetime"]);
});

test("parses the optional --legacy flag before --", () => {
  const parsed = parseCliArgs(["--legacy", "--", "npm", "run", "test:all"]);
  assert.equal(parsed.legacy, true);
  assert.equal(parsed.runner, "npm");
  assert.deepEqual(parsed.args, ["run", "test:all"]);
});

test("treats --legacy after -- as a callback argument", () => {
  const parsed = parseCliArgs(["--", "node", "-e", "1", "--legacy"]);
  assert.equal(parsed.legacy, false);
  assert.deepEqual(parsed.args, ["-e", "1", "--legacy"]);
});

test("accepts help without a callback", () => {
  assert.deepEqual(parseCliArgs(["--help"]), { help: true });
  assert.deepEqual(parseCliArgs(["-h"]), { help: true });
});

test("rejects malformed command lines before provisioning", () => {
  const malformed = [
    [],
    ["node"],
    ["--"],
    ["--", "bash", "-c", "echo unsafe"],
    ["--", "node"],
    ["--", "node", "-e"],
    ["--", "node", "-e", ""],
    ["--", "node", "--eval="],
    ["--", "npm"],
    ["--bogus", "--", "node", "-e", "1"],
  ];
  for (const argv of malformed) {
    assert.throws(
      () => parseCliArgs(argv),
      /Expected|Unsupported|Unknown|needs/u,
      JSON.stringify(argv),
    );
  }
});

test("rejects a missing node script before provisioning", () => {
  assert.throws(
    () => parseCliArgs(["--", "node", "./definitely-not-a-real-script.mjs"]),
    /node script not found/u,
  );
});

test("accepts node test/eval forms and npm subcommands", () => {
  assert.equal(parseCliArgs(["--", "node", "--test"]).runner, "node");
  assert.equal(parseCliArgs(["--", "node", "--eval=1 + 1"]).runner, "node");
  assert.equal(parseCliArgs(["--", "npm", "--version"]).runner, "npm");
});

test("builds one matching V2 database and one separate synthetic database", () => {
  const plan = makePlan();
  const v2 = new URL(plan.v2Url);
  const legacy = new URL(plan.legacyUrl);

  assert.equal(plan.host, "127.0.0.1");
  assert.equal(plan.port, 55432);
  assert.match(plan.v2Database, TEST_DB_NAME_PATTERN);
  assert.match(plan.v2Database, /^wms_[a-f0-9]{16,}_test$/u);
  assert.notEqual(plan.v2Database, plan.legacyDatabase);

  assert.equal(v2.protocol, "postgresql:");
  assert.equal(v2.hostname, "127.0.0.1");
  assert.equal(v2.port, "55432");
  assert.equal(v2.port, String(plan.port));
  assert.notEqual(v2.port, "5432");
  assert.equal(v2.search, "");
  assert.equal(legacy.search, "");
  assert.equal(v2.hash, "");
  assert.equal(legacy.hash, "");
  assert.equal(
    decodeURIComponent(v2.pathname.slice(1)),
    plan.v2Database,
  );
  assert.equal(
    decodeURIComponent(legacy.pathname.slice(1)),
    plan.legacyDatabase,
  );
  assert.ok(v2.password.length >= 16);
  assert.ok(plan.password.length >= 16);
});

test("generated plans are unique per invocation", () => {
  const first = buildDatabasePlan({ port: 55433 });
  const second = buildDatabasePlan({ port: 55434 });
  assert.notEqual(first.v2Database, second.v2Database);
  assert.notEqual(first.legacyDatabase, second.legacyDatabase);
  assert.match(first.v2Database, TEST_DB_NAME_PATTERN);
  assert.match(second.v2Database, TEST_DB_NAME_PATTERN);
});

test("rejects unsafe generated plans", () => {
  assert.throws(() => makePlan({ port: 5432 }), /5432/u);
  assert.throws(() => makePlan({ hex: "abc" }), /hexadecimal/u);
  assert.throws(() => makePlan({ user: "9bad" }), /identifier/u);
  assert.throws(() => makePlan({ password: "short" }), /password/u);
});

test("child environment cannot fall back to caller databases or libpq settings", () => {
  const plan = makePlan();
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/home/tester",
    NODE_ENV: "production",
    WMS_TEST_DB_MANAGED: "0",
    DATABASE_URL: "postgresql://caller:caller-secret@127.0.0.1:5432/caller",
    V2_DATABASE_URL: "postgresql://caller:caller-secret@127.0.0.1:5432/caller_v2",
    SHADOW_DATABASE_URL: "postgresql://caller:caller-secret@127.0.0.1:5432/caller_shadow",
    DIRECT_URL: "postgresql://caller:caller-secret@127.0.0.1:5432/caller_direct",
    PGHOST: "caller-host",
    PGPASSWORD: "caller-secret",
    PGSERVICE: "caller-service",
    PGSSLMODE: "require",
  };

  const env = buildManagedEnvironment(baseEnv, plan);

  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.WMS_TEST_DB_MANAGED, "1");
  assert.equal(env.V2_DATABASE_URL, plan.v2Url);
  assert.equal(env.DATABASE_URL, plan.legacyUrl);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/tester");
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.PGSERVICE, undefined);
  assert.equal(env.PGSSLMODE, undefined);
  assert.ok(!JSON.stringify(env).includes("caller"));
});

test("provisioning-only extra environment is added after sanitizing", () => {
  const plan = makePlan();
  const env = buildManagedEnvironment({ PATH: "/usr/bin" }, plan, {
    PGPASSWORD: plan.password,
  });
  assert.equal(env.PGPASSWORD, plan.password);
  assert.equal(env.V2_DATABASE_URL, plan.v2Url);
});

test("prefers npm_execpath for npm invocation", () => {
  const cli = join("fake-node", "node_modules", "npm", "bin", "npm-cli.js");
  const result = resolveNpmInvocation({
    env: { npm_execpath: cli },
    execPath: join("fake-node", "node"),
    fileExists: (path) => path === cli,
  });
  assert.deepEqual(result, {
    command: join("fake-node", "node"),
    args: [cli],
    source: "npm_execpath",
  });
});

test("discovers npm beside the running node binary", () => {
  const execPath = join("root", "node", "bin", "node");
  const expected = join(
    "root",
    "node",
    "bin",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const result = resolveNpmInvocation({
    env: { PATH: "" },
    execPath,
    fileExists: (path) => path === expected,
  });
  assert.equal(result.command, execPath);
  assert.deepEqual(result.args, [expected]);
  assert.equal(result.source, "node-directory");
});

test("discovers npm on PATH without a shell", () => {
  const binDir = join("tools", "nodejs");
  const expected = join(binDir, "node_modules", "npm", "bin", "npm-cli.js");
  const result = resolveNpmInvocation({
    env: { PATH: binDir },
    execPath: join("other", "node"),
    fileExists: (path) => path === expected,
  });
  assert.equal(result.command, join("other", "node"));
  assert.deepEqual(result.args, [expected]);
  assert.equal(result.source, "PATH");
});

test("reports a missing npm CLI", () => {
  assert.throws(
    () =>
      resolveNpmInvocation({
        env: { PATH: "" },
        execPath: join("missing", "node"),
        fileExists: () => false,
      }),
    /Cannot locate the npm CLI/u,
  );
});

test("redacts passwords and database URLs", () => {
  const secret = "a-very-private-password";
  const text = `url=postgresql://wms:${secret}@127.0.0.1:55432/wms_x_test PGPASSWORD=${secret}`;
  const redacted = redactSensitive(text, [secret]);
  assert.ok(!redacted.includes(secret));
  assert.match(redacted, /postgresql:\/\/\[redacted\]/u);
  assert.match(redacted, /PGPASSWORD=\[redacted\]/u);
});

test("recognizes PostgreSQL port collision messages", () => {
  assert.equal(
    isPortCollisionMessage("could not bind IPv4 address: Address already in use"),
    true,
  );
  assert.equal(isPortCollisionMessage("could not create listen socket"), true);
  assert.equal(isPortCollisionMessage("database files are incompatible"), false);
});
