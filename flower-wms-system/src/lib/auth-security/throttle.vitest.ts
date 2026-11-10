import { describe, expect, it } from "vitest";
import { CredentialsSignin } from "@auth/core/errors";
import { accountThrottleKey, sourceThrottleKey } from "./keys";
import type { LoginThrottlePolicy } from "./policy";
import { createMemoryThrottleStore, type ThrottleStateStore } from "./store";
import {
  LoginThrottledError,
  createLoginThrottle,
  guardCredentialsLogin,
  retryAfterSecondsBucket,
  type GuardCredentialsLoginInput,
  type LoginAttemptReason,
  type LoginVerifyResult,
} from "./throttle";

const T0 = 1_000_000;

function makePolicy(overrides: {
  enabled?: boolean;
  account?: { max: number; windowMs: number; lockMs: number };
  source?: { max: number; windowMs: number; lockMs: number };
  trustedProxyHops?: number;
  failOpen?: boolean;
} = {}): LoginThrottlePolicy {
  return {
    enabled: overrides.enabled ?? true,
    account: overrides.account ?? { max: 3, windowMs: 60_000, lockMs: 60_000 },
    source: overrides.source ?? { max: 100, windowMs: 60_000, lockMs: 60_000 },
    trustedProxyHops: overrides.trustedProxyHops ?? 0,
    store: { maxEntries: 100, ttlMs: 3_600_000 },
    failOpen: overrides.failOpen ?? true,
  };
}

function setup(options: {
  policy?: LoginThrottlePolicy;
  store?: ThrottleStateStore;
} = {}) {
  let now = T0;
  const clock = () => now;
  const policy = options.policy ?? makePolicy();
  const store =
    options.store ??
    createMemoryThrottleStore({
      maxEntries: policy.store.maxEntries,
      ttlMs: policy.store.ttlMs,
      clock,
    });
  const throttle = createLoginThrottle({ policy, store, clock });
  return {
    throttle,
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function requestWithForwardedFor(value: string): Request {
  return new Request("https://example.com/api/auth/callback/v2-credentials", {
    headers: { "x-forwarded-for": value },
  });
}

type GuardHarness = {
  attempts: Array<{ outcome: string; reason: LoginAttemptReason }>;
  throttled: Array<{ scope: string; retryAfterSecondsBucket: number }>;
  storeErrors: number;
};

function makeGuardHarness<T>(
  throttle: ReturnType<typeof createLoginThrottle>,
  options: {
    provider?: "legacy" | "v2";
    username: string;
    request?: Request;
    hasPassword?: boolean;
    verify: () => Promise<LoginVerifyResult<T>>;
  },
) {
  const harness: GuardHarness = { attempts: [], throttled: [], storeErrors: 0 };
  return {
    harness,
    run: () =>
      guardCredentialsLogin<T>({
        provider: options.provider ?? "v2",
        username: options.username,
        request: options.request,
        throttle,
        hasPassword: options.hasPassword,
        verify: options.verify,
        onAttempt: ({ outcome, reason }) => harness.attempts.push({ outcome, reason }),
        onThrottled: ({ scope, retryAfterSecondsBucket }) =>
          harness.throttled.push({ scope, retryAfterSecondsBucket }),
        onStoreError: () => {
          harness.storeErrors += 1;
        },
      } satisfies GuardCredentialsLoginInput<T>),
  };
}

describe("retryAfterSecondsBucket", () => {
  it("maps remaining seconds to the documented buckets", () => {
    expect(retryAfterSecondsBucket(0)).toBe(0);
    expect(retryAfterSecondsBucket(1)).toBe(15);
    expect(retryAfterSecondsBucket(15)).toBe(15);
    expect(retryAfterSecondsBucket(16)).toBe(60);
    expect(retryAfterSecondsBucket(60)).toBe(60);
    expect(retryAfterSecondsBucket(61)).toBe(300);
    expect(retryAfterSecondsBucket(900)).toBe(300);
  });
});

describe("throttle disabled by default", () => {
  it("is a no-op for checks and records", () => {
    const { throttle, store } = setup({ policy: makePolicy({ enabled: false }) });
    expect(throttle.check({ username: "admin", source: null })).toEqual({
      allowed: true,
      storeError: false,
    });
    expect(throttle.recordFailure({ username: "admin", source: null })).toEqual({
      storeError: false,
    });
    expect(throttle.recordSuccess({ username: "admin" })).toEqual({ storeError: false });
    expect(throttle.storeSize()).toBe(0);
    expect(store.size()).toBe(0);
  });
});

describe("account threshold and lock", () => {
  it("locks after max failures and reports a retry bucket", () => {
    const { throttle } = setup({ policy: makePolicy({ account: { max: 3, windowMs: 60_000, lockMs: 60_000 } }) });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(throttle.check({ username: "admin", source: null }).allowed).toBe(true);
      throttle.recordFailure({ username: "admin", source: null });
    }
    const blocked = throttle.check({ username: "admin", source: null });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.scope).toBe("account");
      expect(blocked.retryAfterSecondsBucket).toBe(60);
    }
  });

  it("uses the documented buckets for short and long locks", () => {
    const cases: Array<[number, number]> = [
      [15_000, 15],
      [45_000, 60],
      [120_000, 300],
    ];
    for (const [lockMs, expectedBucket] of cases) {
      const { throttle } = setup({ policy: makePolicy({ account: { max: 1, windowMs: 60_000, lockMs } }) });
      throttle.recordFailure({ username: "admin", source: null });
      const blocked = throttle.check({ username: "admin", source: null });
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) expect(blocked.retryAfterSecondsBucket).toBe(expectedBucket);
    }
  });

  it("recovers after the lock expires and starts a fresh budget", () => {
    const { throttle, advance, store } = setup({
      policy: makePolicy({ account: { max: 2, windowMs: 600_000, lockMs: 60_000 } }),
    });
    throttle.recordFailure({ username: "admin", source: null });
    throttle.recordFailure({ username: "admin", source: null });
    expect(throttle.check({ username: "admin", source: null }).allowed).toBe(false);
    advance(60_001);
    expect(throttle.check({ username: "admin", source: null }).allowed).toBe(true);
    throttle.recordFailure({ username: "admin", source: null });
    const bucket = store.get(accountThrottleKey("admin"));
    expect(bucket?.failures).toBe(1);
    expect(bucket?.lockedUntilMs).toBe(0);
  });

  it("resets the failure window after it expires when no lock is configured", () => {
    const { throttle, advance, store } = setup({
      policy: makePolicy({ account: { max: 2, windowMs: 10_000, lockMs: 0 } }),
    });
    throttle.recordFailure({ username: "admin", source: null });
    advance(10_001);
    throttle.recordFailure({ username: "admin", source: null });
    expect(store.get(accountThrottleKey("admin"))?.failures).toBe(1);
  });
});

describe("source dimension and trusted proxy hops", () => {
  it("ignores X-Forwarded-For with zero trusted hops", () => {
    const { throttle } = setup({
      policy: makePolicy({ trustedProxyHops: 0, source: { max: 1, windowMs: 60_000, lockMs: 60_000 } }),
    });
    const source = throttle.sourceFor(requestWithForwardedFor("6.6.6.6, 203.0.113.9"));
    expect(source).toBeNull();
    throttle.recordFailure({ username: "admin", source });
    expect(throttle.check({ username: "admin", source: null }).allowed).toBe(true);
  });

  it("uses only the address appended by the trusted proxy", () => {
    const { throttle } = setup({
      policy: makePolicy({ trustedProxyHops: 1, source: { max: 1, windowMs: 60_000, lockMs: 60_000 } }),
    });
    const real = throttle.sourceFor(requestWithForwardedFor("6.6.6.6, 203.0.113.9"));
    expect(real).toBe("203.0.113.9");
    throttle.recordFailure({ username: "admin", source: real });
    const forged = throttle.sourceFor(requestWithForwardedFor("1.1.1.1, 203.0.113.9"));
    expect(forged).toBe("203.0.113.9");
    const blocked = throttle.check({ username: "another-user", source: forged });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.scope).toBe("source");
  });

  it("locks both scopes when both budgets are exhausted", () => {
    const { throttle } = setup({
      policy: makePolicy({
        account: { max: 1, windowMs: 60_000, lockMs: 60_000 },
        source: { max: 1, windowMs: 60_000, lockMs: 60_000 },
        trustedProxyHops: 1,
      }),
    });
    const source = "203.0.113.9";
    throttle.recordFailure({ username: "admin", source });
    const blocked = throttle.check({ username: "admin", source });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.scope).toBe("both");
    expect(throttle.storeSize()).toBe(2);
    expect(sourceThrottleKey("203.0.113.9").startsWith("source:")).toBe(true);
  });
});

describe("success resets only the account budget", () => {
  it("keeps source abuse history after a successful login", () => {
    const { throttle } = setup({
      policy: makePolicy({
        account: { max: 3, windowMs: 600_000, lockMs: 600_000 },
        source: { max: 3, windowMs: 600_000, lockMs: 600_000 },
        trustedProxyHops: 1,
      }),
    });
    const source = "203.0.113.9";
    throttle.recordFailure({ username: "admin", source });
    throttle.recordFailure({ username: "admin", source });
    throttle.recordSuccess({ username: "admin" });
    expect(throttle.check({ username: "admin", source }).allowed).toBe(true);
    throttle.recordFailure({ username: "admin", source });
    const blocked = throttle.check({ username: "someone-else", source });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.scope).toBe("source");
  });
});

describe("store failures", () => {
  const brokenStore: ThrottleStateStore = {
    get() {
      throw new Error("store unavailable");
    },
    set() {
      throw new Error("store unavailable");
    },
    delete() {
      throw new Error("store unavailable");
    },
    size() {
      throw new Error("store unavailable");
    },
  };

  it("fails open by default and reports degradation", () => {
    const { throttle } = setup({ policy: makePolicy({ failOpen: true }), store: brokenStore });
    expect(throttle.check({ username: "admin", source: null })).toEqual({
      allowed: true,
      storeError: true,
    });
    expect(throttle.recordFailure({ username: "admin", source: null })).toEqual({
      storeError: true,
    });
    expect(throttle.recordSuccess({ username: "admin" })).toEqual({ storeError: true });
    expect(throttle.storeSize()).toBe(0);
  });

  it("fails closed when failOpen is disabled", () => {
    const { throttle } = setup({ policy: makePolicy({ failOpen: false }), store: brokenStore });
    const check = throttle.check({ username: "admin", source: null });
    expect(check.allowed).toBe(false);
    expect(check.storeError).toBe(true);
    if (!check.allowed) expect(check.retryAfterSecondsBucket).toBe(60);
  });
});

describe("guardCredentialsLogin", () => {
  it("returns null for unknown user / wrong password / inactive with the same external result", async () => {
    const { throttle } = setup({ policy: makePolicy({ account: { max: 99, windowMs: 60_000, lockMs: 60_000 } }) });
    for (const reason of ["unknown_user", "wrong_password", "inactive"] as const) {
      const { run, harness } = makeGuardHarness(throttle, {
        username: `user-${reason}`,
        verify: async () => ({ outcome: "failure", reason }),
      });
      await expect(run()).resolves.toBeNull();
      expect(harness.attempts).toEqual([{ outcome: "failure", reason }]);
    }
  });

  it("returns the verified user and resets the account budget on success", async () => {
    const { throttle, store } = setup();
    throttle.recordFailure({ username: "admin", source: null });
    const { run, harness } = makeGuardHarness(throttle, {
      username: "admin",
      verify: async () => ({ outcome: "success", value: { id: "staff-1" } }),
    });
    await expect(run()).resolves.toEqual({ id: "staff-1" });
    expect(harness.attempts).toEqual([{ outcome: "success", reason: "ok" }]);
    expect(store.get(accountThrottleKey("admin"))).toBeUndefined();
  });

  it("does not count missing credentials", async () => {
    const { throttle, store } = setup();
    const { run, harness } = makeGuardHarness(throttle, {
      username: "",
      verify: async () => ({ outcome: "failure", reason: "missing_credentials" }),
    });
    await expect(run()).resolves.toBeNull();
    expect(harness.attempts).toEqual([{ outcome: "failure", reason: "missing_credentials" }]);
    expect(throttle.storeSize()).toBe(0);
    expect(store.size()).toBe(0);
  });

  it("does not throttle an incomplete credential submission", async () => {
    const { throttle } = setup({
      policy: makePolicy({ account: { max: 1, windowMs: 60_000, lockMs: 60_000 } }),
    });
    throttle.recordFailure({ username: "admin", source: null });
    expect(throttle.check({ username: "admin", source: null }).allowed).toBe(false);
    const { run, harness } = makeGuardHarness(throttle, {
      username: "admin",
      hasPassword: false,
      verify: async () => ({ outcome: "failure", reason: "missing_credentials" }),
    });
    await expect(run()).resolves.toBeNull();
    expect(harness.attempts).toEqual([{ outcome: "failure", reason: "missing_credentials" }]);
    expect(harness.throttled).toEqual([]);
  });

  it("throws the stable CredentialsSignin subclass once throttled", async () => {
    const { throttle } = setup({ policy: makePolicy({ account: { max: 1, windowMs: 60_000, lockMs: 10_000 } }) });
    throttle.recordFailure({ username: "admin", source: null });
    const { run, harness } = makeGuardHarness(throttle, {
      username: "admin",
      verify: async () => ({ outcome: "success", value: null }),
    });
    const error = await run().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(LoginThrottledError);
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect((error as LoginThrottledError).code).toBe("too_many_attempts");
    expect(harness.attempts).toEqual([{ outcome: "failure", reason: "throttled" }]);
    expect(harness.throttled).toEqual([{ scope: "account", retryAfterSecondsBucket: 15 }]);
  });

  it("rethrows verification errors unchanged and logs internal_error", async () => {
    const { throttle } = setup();
    const failure = new Error("database down");
    const { run, harness } = makeGuardHarness(throttle, {
      username: "admin",
      verify: async () => ({ outcome: "error", error: failure }),
    });
    await expect(run()).rejects.toBe(failure);
    expect(harness.attempts).toEqual([{ outcome: "failure", reason: "internal_error" }]);
    expect(harness.storeErrors).toBe(0);
  });

  it("fails open on store errors and reports store_error exactly once", async () => {
    const brokenStore: ThrottleStateStore = {
      get() {
        throw new Error("boom");
      },
      set() {
        throw new Error("boom");
      },
      delete() {
        throw new Error("boom");
      },
      size() {
        throw new Error("boom");
      },
    };
    const { throttle } = setup({ policy: makePolicy({ failOpen: true }), store: brokenStore });
    const { run, harness } = makeGuardHarness(throttle, {
      username: "admin",
      verify: async () => ({ outcome: "success", value: { id: "staff-1" } }),
    });
    await expect(run()).resolves.toEqual({ id: "staff-1" });
    expect(harness.storeErrors).toBe(1);
    expect(harness.attempts).toEqual([{ outcome: "success", reason: "ok" }]);
  });

  it("counts concurrent failures and blocks the next attempt", async () => {
    const { throttle } = setup({ policy: makePolicy({ account: { max: 5, windowMs: 60_000, lockMs: 60_000 } }) });
    const attempts = Array.from({ length: 12 }, (_, index) =>
      makeGuardHarness(throttle, {
        username: "admin",
        verify: async () => {
          await Promise.resolve();
          return {
            outcome: "failure" as const,
            reason: index % 2 === 0 ? ("wrong_password" as const) : ("unknown_user" as const),
          };
        },
      }).run(),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const blocked = await makeGuardHarness(throttle, {
      username: "admin",
      verify: async () => ({ outcome: "success", value: null }),
    }).run().catch((thrown: unknown) => thrown);
    expect(blocked).toBeInstanceOf(LoginThrottledError);
  });
});

