import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGIN_THROTTLE_POLICY,
  resolveLoginThrottlePolicy,
} from "./policy";

describe("login throttle policy", () => {
  it("uses the documented conservative defaults", () => {
    const policy = resolveLoginThrottlePolicy({});
    expect(policy.enabled).toBe(false);
    expect(policy.account).toEqual({ max: 5, windowMs: 900_000, lockMs: 900_000 });
    expect(policy.source).toEqual({ max: 20, windowMs: 900_000, lockMs: 900_000 });
    expect(policy.trustedProxyHops).toBe(0);
    expect(policy.store).toEqual({ maxEntries: 10_000, ttlMs: 3_600_000 });
    expect(policy.failOpen).toBe(true);
    expect(DEFAULT_LOGIN_THROTTLE_POLICY.enabled).toBe(false);
  });

  it("reads every documented env override", () => {
    const policy = resolveLoginThrottlePolicy({
      LOGIN_THROTTLE_ENABLED: "true",
      LOGIN_THROTTLE_ACCOUNT_MAX: "3",
      LOGIN_THROTTLE_ACCOUNT_WINDOW_MS: "60000",
      LOGIN_THROTTLE_ACCOUNT_LOCK_MS: "120000",
      LOGIN_THROTTLE_SOURCE_MAX: "7",
      LOGIN_THROTTLE_SOURCE_WINDOW_MS: "120000",
      LOGIN_THROTTLE_SOURCE_LOCK_MS: "300000",
      TRUSTED_PROXY_HOPS: "1",
      LOGIN_THROTTLE_STORE_MAX: "500",
      LOGIN_THROTTLE_STORE_TTL_MS: "120000",
      LOGIN_THROTTLE_FAIL_OPEN: "false",
    });
    expect(policy.enabled).toBe(true);
    expect(policy.account).toEqual({ max: 3, windowMs: 60_000, lockMs: 120_000 });
    expect(policy.source).toEqual({ max: 7, windowMs: 120_000, lockMs: 300_000 });
    expect(policy.trustedProxyHops).toBe(1);
    expect(policy.store).toEqual({ maxEntries: 500, ttlMs: 120_000 });
    expect(policy.failOpen).toBe(false);
  });

  it("falls back on invalid or out-of-range values instead of crashing login", () => {
    const policy = resolveLoginThrottlePolicy({
      LOGIN_THROTTLE_ENABLED: "maybe",
      LOGIN_THROTTLE_ACCOUNT_MAX: "0",
      LOGIN_THROTTLE_ACCOUNT_WINDOW_MS: "not-a-number",
      LOGIN_THROTTLE_ACCOUNT_LOCK_MS: "-5",
      LOGIN_THROTTLE_SOURCE_MAX: "99999999",
      TRUSTED_PROXY_HOPS: "99",
      LOGIN_THROTTLE_STORE_MAX: "1",
      LOGIN_THROTTLE_FAIL_OPEN: "perhaps",
    });
    expect(policy).toEqual(resolveLoginThrottlePolicy({}));
  });

  it("keeps lockMs = 0 available (lock disabled while still counting)", () => {
    const policy = resolveLoginThrottlePolicy({ LOGIN_THROTTLE_ACCOUNT_LOCK_MS: "0" });
    expect(policy.account.lockMs).toBe(0);
  });

  it("freezes the resolved policy", () => {
    const policy = resolveLoginThrottlePolicy({});
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.account)).toBe(true);
    expect(Object.isFrozen(policy.source)).toBe(true);
    expect(Object.isFrozen(policy.store)).toBe(true);
  });
});
