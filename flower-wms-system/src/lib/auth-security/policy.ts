/**
 * Environment contract for the Sprint E3.6 login throttle.
 *
 * Production defaults are deliberately conservative: the throttle is OFF unless
 * `LOGIN_THROTTLE_ENABLED=true` is explicitly approved. Thresholds and windows
 * come from the shared E3 contract (§5) and can be overridden per environment;
 * invalid values fall back to the documented default instead of weakening or
 * crashing sign-in.
 */

export type LoginThrottlePolicy = Readonly<{
  enabled: boolean;
  account: Readonly<{ max: number; windowMs: number; lockMs: number }>;
  source: Readonly<{ max: number; windowMs: number; lockMs: number }>;
  /** Number of reverse proxies in front of the app that append X-Forwarded-For. 0 = ignore XFF. */
  trustedProxyHops: number;
  store: Readonly<{ maxEntries: number; ttlMs: number }>;
  /** Store failures must never block a legitimate sign-in. */
  failOpen: boolean;
}>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Documented defaults from docs/evidence/sprint-e3/contracts.md §5. */
export const DEFAULT_LOGIN_THROTTLE_POLICY: LoginThrottlePolicy = Object.freeze({
  enabled: false,
  account: Object.freeze({ max: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }),
  source: Object.freeze({ max: 20, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }),
  trustedProxyHops: 0,
  store: Object.freeze({ maxEntries: 10_000, ttlMs: HOUR }),
  failOpen: true,
});

type PolicyEnv = Record<string, string | undefined>;

function readInt(
  env: PolicyEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function readBoolean(
  env: PolicyEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name];
  if (typeof raw !== "string") return fallback;
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return fallback;
}

function readWindow(env: PolicyEnv, name: string, fallback: number): number {
  return readInt(env, name, fallback, 1_000, DAY);
}

/** Resolve the policy for one process (or an injected env object in tests). */
export function resolveLoginThrottlePolicy(
  env: PolicyEnv = process.env,
): LoginThrottlePolicy {
  return Object.freeze({
    enabled: readBoolean(env, "LOGIN_THROTTLE_ENABLED", DEFAULT_LOGIN_THROTTLE_POLICY.enabled),
    account: Object.freeze({
      max: readInt(env, "LOGIN_THROTTLE_ACCOUNT_MAX", DEFAULT_LOGIN_THROTTLE_POLICY.account.max, 1, 1_000),
      windowMs: readWindow(env, "LOGIN_THROTTLE_ACCOUNT_WINDOW_MS", DEFAULT_LOGIN_THROTTLE_POLICY.account.windowMs),
      lockMs: readInt(env, "LOGIN_THROTTLE_ACCOUNT_LOCK_MS", DEFAULT_LOGIN_THROTTLE_POLICY.account.lockMs, 0, DAY),
    }),
    source: Object.freeze({
      max: readInt(env, "LOGIN_THROTTLE_SOURCE_MAX", DEFAULT_LOGIN_THROTTLE_POLICY.source.max, 1, 10_000),
      windowMs: readWindow(env, "LOGIN_THROTTLE_SOURCE_WINDOW_MS", DEFAULT_LOGIN_THROTTLE_POLICY.source.windowMs),
      lockMs: readInt(env, "LOGIN_THROTTLE_SOURCE_LOCK_MS", DEFAULT_LOGIN_THROTTLE_POLICY.source.lockMs, 0, DAY),
    }),
    trustedProxyHops: readInt(env, "TRUSTED_PROXY_HOPS", DEFAULT_LOGIN_THROTTLE_POLICY.trustedProxyHops, 0, 10),
    store: Object.freeze({
      maxEntries: readInt(env, "LOGIN_THROTTLE_STORE_MAX", DEFAULT_LOGIN_THROTTLE_POLICY.store.maxEntries, 100, 100_000),
      ttlMs: readWindow(env, "LOGIN_THROTTLE_STORE_TTL_MS", DEFAULT_LOGIN_THROTTLE_POLICY.store.ttlMs),
    }),
    failOpen: readBoolean(env, "LOGIN_THROTTLE_FAIL_OPEN", DEFAULT_LOGIN_THROTTLE_POLICY.failOpen),
  });
}
