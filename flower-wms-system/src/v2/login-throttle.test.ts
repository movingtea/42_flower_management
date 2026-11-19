import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma-v2/client";
import {
  LoginThrottledError,
  accountThrottleKey,
  createLoginThrottle,
  guardCredentialsLogin,
  type LoginAttemptReason,
  type LoginVerifyResult,
  type ThrottleStateStore,
} from "../lib/auth-security";
import { authenticateV2Staff } from "./auth";

/**
 * E3.6 login-throttle integration test (discovered by
 * `npm run test:integration:v2`).
 *
 * It exercises the exact `guardCredentialsLogin` gate used by `src/auth.ts`
 * against the real V2 database and the real `authenticateV2Staff` credential
 * verification, with an injected clock/policy so thresholds are fast and
 * deterministic. No plaintext username, password or IP is printed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..", "..");

function makePolicy(overrides: {
  account?: { max: number; windowMs: number; lockMs: number };
  source?: { max: number; windowMs: number; lockMs: number };
  trustedProxyHops?: number;
} = {}) {
  return {
    enabled: true,
    account: overrides.account ?? { max: 3, windowMs: 60_000, lockMs: 60_000 },
    source: overrides.source ?? { max: 100, windowMs: 60_000, lockMs: 60_000 },
    trustedProxyHops: overrides.trustedProxyHops ?? 0,
    store: { maxEntries: 100, ttlMs: 3_600_000 },
    failOpen: true,
  } as const;
}

function sourceWiringContract(): void {
  const source = readFileSync(join(APP_ROOT, "src", "auth.ts"), "utf8");
  // Both providers must go through the unified gate and receive the request.
  assert.equal(source.includes("async function authorizeLegacy("), true);
  assert.equal(source.includes("async function authorizeV2("), true);
  assert.equal(source.includes("request: Request"), true);
  assert.equal(source.includes("guardCredentialsLogin<User>"), true);
  assert.equal(source.includes("authorize: authorizeLegacy"), true);
  assert.equal(source.includes("authorize: authorizeV2"), true);
  assert.equal(source.includes('event: "auth.login.throttled"'), true);
  const throttleSource = readFileSync(join(APP_ROOT, "src", "lib", "auth-security", "throttle.ts"), "utf8");
  assert.equal(throttleSource.includes("class LoginThrottledError extends CredentialsSignin"), true);
  assert.equal(throttleSource.includes('code = "too_many_attempts"'), true);
}

async function main(): Promise<void> {
  sourceWiringContract();
  console.log("[e36] wiring: both providers call guardCredentialsLogin and receive the Request; throttled error is a CredentialsSignin subclass with code too_many_attempts");

  const connectionString = process.env.V2_DATABASE_URL;
  const requireDb = process.env.WMS_TEST_DB_MANAGED === "1";
  if (!connectionString) {
    if (requireDb) throw new Error("V2_DATABASE_URL is required under the managed test database");
    console.log("login throttle source wiring checked (no database URL supplied)");
    return;
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const marker = crypto.randomUUID().slice(0, 8);
  const created = {
    tenantId: "",
    storeId: "",
    staffIds: [] as string[],
  };

  try {
    await db.$queryRaw`SELECT 1`;

    const tenant = await db.tenant.create({
      data: { slug: `e36-login-throttle-${marker}`, name: "E3.6 限流测试租户" },
    });
    created.tenantId = tenant.id;
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "E3.6 限流测试门店" },
    });
    created.storeId = store.id;

    const password = "IntegrationPass123!";
    const passwordHash = await bcrypt.hash(password, 10);

    async function createStaff(options: {
      username: string;
      active?: boolean;
    }): Promise<string> {
      const staff = await db.staffUser.create({
        data: {
          username: options.username,
          passwordHash,
          displayName: options.username,
          active: options.active ?? true,
        },
      });
      created.staffIds.push(staff.id);
      await db.tenantMember.create({
        data: { tenantId: tenant.id, staffUserId: staff.id, roles: ["ADMIN"], active: true },
      });
      await db.storeMember.create({
        data: { storeId: store.id, staffUserId: staff.id, roles: ["ADMIN"], active: true },
      });
      return staff.id;
    }

    // Mirrors src/auth.ts verifyV2Login exactly (same module path + loader).
    async function verifyV2(
      username: string,
      candidatePassword: string,
    ): Promise<LoginVerifyResult<{ id: string }>> {
      if (!username || !candidatePassword) {
        return { outcome: "failure", reason: "missing_credentials" };
      }
      try {
        let loadedStaffActive: boolean | null = null;
        const principal = await authenticateV2Staff(
          { username, password: candidatePassword },
          async (candidateUsername) => {
            const staff = await db.staffUser.findUnique({
              where: { username: candidateUsername },
              include: { tenantMembers: true, storeMembers: { include: { store: true } } },
            });
            loadedStaffActive = staff ? staff.active : null;
            return staff;
          },
        );
        if (!principal) {
          return {
            outcome: "failure",
            reason:
              loadedStaffActive === null
                ? "unknown_user"
                : loadedStaffActive === false
                  ? "inactive"
                  : "wrong_password",
          };
        }
        return { outcome: "success", value: { id: principal.id } };
      } catch (error) {
        return { outcome: "error", error };
      }
    }

    function makeHarness(
      throttle: ReturnType<typeof createLoginThrottle>,
      options: { username: string; password: string; forwardedFor?: string },
    ) {
      const attempts: Array<{ outcome: string; reason: LoginAttemptReason }> = [];
      const throttled: Array<{ scope: string; retryAfterSecondsBucket: number }> = [];
      let storeErrors = 0;
      const request =
        options.forwardedFor === undefined
          ? undefined
          : new Request(
              "https://example.com/api/auth/callback/v2-credentials",
              { headers: { "x-forwarded-for": options.forwardedFor } },
            );
      return {
        attempts,
        throttled,
        storeErrors: () => storeErrors,
        run: () =>
          guardCredentialsLogin<{ id: string }>({
            provider: "v2",
            username: options.username,
            request,
            throttle,
            verify: () => verifyV2(options.username, options.password),
            onAttempt: ({ outcome, reason }) => attempts.push({ outcome, reason }),
            onThrottled: ({ scope, retryAfterSecondsBucket }) =>
              throttled.push({ scope, retryAfterSecondsBucket }),
            onStoreError: () => {
              storeErrors += 1;
            },
          }),
      };
    }

    const baseUsername = `e36user${marker}`;
    const staffId = await createStaff({ username: baseUsername });
    const inactiveUsername = `e36inactive${marker}`;
    await createStaff({ username: inactiveUsername, active: false });

    // 1. Unknown / wrong password / inactive all look the same externally.
    {
      const throttle = createLoginThrottle({ policy: makePolicy() });
      const cases = [
        { username: `e36missing${marker}`, password, reason: "unknown_user" },
        { username: baseUsername, password: "WrongPassword1!", reason: "wrong_password" },
        { username: inactiveUsername, password, reason: "inactive" },
      ] as const;
      for (const testCase of cases) {
        const harness = makeHarness(throttle, testCase);
        assert.equal(await harness.run(), null);
        assert.ok(
          harness.attempts.some((attempt) => attempt.reason === testCase.reason),
          `expected log reason ${testCase.reason}`,
        );
      }
      console.log("[e36] external parity: unknown_user / wrong_password / inactive all return null, no throw, reasons logged");
    }

    // 2. Account budget exhausts through the real credential check.
    {
      let now = 1_000_000;
      const throttle = createLoginThrottle({
        policy: makePolicy({ account: { max: 3, windowMs: 60_000, lockMs: 60_000 } }),
        clock: () => now,
      });
      const harness = makeHarness(throttle, { username: baseUsername, password: "WrongPassword1!" });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal(await harness.run(), null);
      }
      await assert.rejects(harness.run(), (error: unknown) => {
        assert.ok(error instanceof LoginThrottledError);
        assert.equal(error.code, "too_many_attempts");
        return true;
      });
      assert.deepEqual(harness.throttled, [{ scope: "account", retryAfterSecondsBucket: 60 }]);
      assert.deepEqual(harness.attempts.at(-1), { outcome: "failure", reason: "throttled" });
      // A correct password cannot bypass the account lock.
      const correct = makeHarness(throttle, { username: baseUsername, password });
      await assert.rejects(correct.run(), LoginThrottledError);
      // Lock release starts a fresh budget (real clock step).
      now += 60_001;
      const recovered = makeHarness(throttle, { username: baseUsername, password });
      assert.deepEqual(await recovered.run(), { id: staffId });
      console.log("[e36] account threshold: 3 failures lock (bucket 60), correct password still blocked, lock release recovers");
    }

    // 3. Success resets the account budget but keeps the source history.
    {
      const throttle = createLoginThrottle({
        policy: makePolicy({
          account: { max: 100, windowMs: 600_000, lockMs: 600_000 },
          source: { max: 3, windowMs: 600_000, lockMs: 600_000 },
          trustedProxyHops: 1,
        }),
      });
      const source = "203.0.113.9";
      const failing = makeHarness(throttle, {
        username: baseUsername,
        password: "WrongPassword1!",
        forwardedFor: `6.6.6.6, ${source}`,
      });
      assert.equal(await failing.run(), null);
      assert.equal(await failing.run(), null);
      const success = makeHarness(throttle, {
        username: baseUsername,
        password,
        forwardedFor: `6.6.6.6, ${source}`,
      });
      assert.deepEqual(await success.run(), { id: staffId });
      // The success deleted only the account bucket.
      assert.equal(throttle.storeSize(), 1);
      assert.equal(await failing.run(), null); // source failures = 3 -> locked
      const blocked = makeHarness(throttle, {
        username: `e36other${marker}`,
        password,
        forwardedFor: `9.9.9.9, ${source}`,
      });
      await assert.rejects(blocked.run(), (error: unknown) => {
        assert.ok(error instanceof LoginThrottledError);
        return true;
      });
      assert.equal(blocked.throttled[0]?.scope, "source");
      console.log("[e36] success resets only the account bucket; retained source history still blocks");
    }

    // 4. With TRUSTED_PROXY_HOPS=0 a forged X-Forwarded-For cannot lock a source.
    {
      const throttle = createLoginThrottle({
        policy: makePolicy({ source: { max: 1, windowMs: 60_000, lockMs: 60_000 }, trustedProxyHops: 0 }),
      });
      const first = makeHarness(throttle, {
        username: `e36forge-a-${marker}`,
        password: "WrongPassword1!",
        forwardedFor: "6.6.6.6",
      });
      assert.equal(throttle.sourceFor(new Request("https://example.com", { headers: { "x-forwarded-for": "6.6.6.6" } })), null);
      assert.equal(await first.run(), null);
      const second = makeHarness(throttle, {
        username: `e36forge-b-${marker}`,
        password: "WrongPassword1!",
        forwardedFor: "7.7.7.7",
      });
      await assert.doesNotReject(second.run());
      console.log("[e36] TRUSTED_PROXY_HOPS=0 ignores forged X-Forwarded-For (no source lock)");
    }

    // 5. Store outage fails open and is reported, never blocks a valid login.
    {
      const brokenStore: ThrottleStateStore = {
        get() {
          throw new Error("store down");
        },
        set() {
          throw new Error("store down");
        },
        delete() {
          throw new Error("store down");
        },
        size() {
          throw new Error("store down");
        },
      };
      const throttle = createLoginThrottle({ policy: makePolicy(), store: brokenStore });
      const harness = makeHarness(throttle, { username: baseUsername, password });
      assert.deepEqual(await harness.run(), { id: staffId });
      assert.equal(harness.storeErrors(), 1);
      console.log("[e36] store outage fails open and reports store_error once");
    }

    // 6. Concurrent failures are all counted and the next attempt is blocked.
    {
      const throttle = createLoginThrottle({
        policy: makePolicy({ account: { max: 5, windowMs: 60_000, lockMs: 60_000 } }),
      });
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          makeHarness(throttle, {
            username: index % 2 === 0 ? baseUsername : `e36concurrent${marker}`,
            password: "WrongPassword1!",
          }).run(),
        ),
      );
      assert.equal(results.every((result) => result.status === "fulfilled"), true);
      assert.equal(throttle.storeSize() >= 1, true);
      const blocked = makeHarness(throttle, { username: baseUsername, password });
      await assert.rejects(blocked.run(), LoginThrottledError);
      assert.ok(blocked.attempts.some((attempt) => attempt.reason === "throttled"));
      console.log("[e36] 12 concurrent failures all counted; the next attempt is throttled");
    }

    // 7. Account bucket keys never contain a username.
    assert.equal(accountThrottleKey(baseUsername).includes(baseUsername), false);
  } finally {
    if (created.storeId) await db.storeMember.deleteMany({ where: { storeId: created.storeId } });
    if (created.tenantId) await db.tenantMember.deleteMany({ where: { tenantId: created.tenantId } });
    for (const staffId of created.staffIds) {
      await db.staffUser.deleteMany({ where: { id: staffId } });
    }
    if (created.storeId) await db.store.deleteMany({ where: { id: created.storeId } });
    if (created.tenantId) await db.tenant.deleteMany({ where: { id: created.tenantId } });
    await db.$disconnect();
  }

  console.log("login throttle integration tests passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});


