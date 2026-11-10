/**
 * Sprint E3.6 login throttle: decision logic shared by both credentials
 * providers.
 *
 * The throttle is applied per account (HMAC fingerprint) and per trusted client
 * source. `guardCredentialsLogin` is the single entry point used by
 * `src/auth.ts` for the legacy and V2 providers, so switching provider cannot
 * bypass the failure budget, and every external rejection is identical
 * (`null` from `authorize`, or `CredentialsSignin` once throttled).
 *
 * Store failures fail open by default: a throttle outage must not become a
 * total login outage. The degradation is reported through the caller's
 * `onStoreError` callback (mapped to `auth.login.attempt` reason=store_error).
 */
import { CredentialsSignin } from "@auth/core/errors";
import {
  accountThrottleKey,
  clientSourceFromRequest,
  normalizeAccountIdentifier,
  sourceThrottleKey,
} from "./keys";
import type { LoginThrottlePolicy } from "./policy";
import {
  createMemoryThrottleStore,
  type ThrottleBucket,
  type ThrottleStateStore,
} from "./store";

/** Thrown when either failure budget is exhausted. `code` is stable for the UI/tests. */
export class LoginThrottledError extends CredentialsSignin {
  code = "too_many_attempts";
}

export type ThrottleScope = "account" | "source" | "both";
export type RetryAfterSecondsBucket = 0 | 15 | 60 | 300;

export type LoginThrottleCheck =
  | { allowed: true; storeError: boolean }
  | {
      allowed: false;
      storeError: boolean;
      scope: ThrottleScope;
      retryAfterSecondsBucket: RetryAfterSecondsBucket;
    };

export type LoginThrottleRecordResult = { storeError: boolean };

export type LoginThrottle = {
  readonly policy: LoginThrottlePolicy;
  sourceFor(request: Request | undefined): string | null;
  check(input: { username: string; source: string | null }): LoginThrottleCheck;
  recordFailure(input: { username: string; source: string | null }): LoginThrottleRecordResult;
  recordSuccess(input: { username: string }): LoginThrottleRecordResult;
  storeSize(): number;
};

export function retryAfterSecondsBucket(seconds: number): RetryAfterSecondsBucket {
  if (seconds <= 0) return 0;
  if (seconds <= 15) return 15;
  if (seconds <= 60) return 60;
  return 300;
}

function lockRetrySeconds(
  accountBucket: ThrottleBucket | undefined,
  sourceBucket: ThrottleBucket | undefined,
  nowMs: number,
): number {
  let lockedUntil = 0;
  if (accountBucket && accountBucket.lockedUntilMs > nowMs) {
    lockedUntil = Math.max(lockedUntil, accountBucket.lockedUntilMs);
  }
  if (sourceBucket && sourceBucket.lockedUntilMs > nowMs) {
    lockedUntil = Math.max(lockedUntil, sourceBucket.lockedUntilMs);
  }
  return lockedUntil === 0 ? 0 : Math.max(0, Math.ceil((lockedUntil - nowMs) / 1_000));
}

export function createLoginThrottle(input: {
  policy: LoginThrottlePolicy;
  store?: ThrottleStateStore;
  clock?: () => number;
}): LoginThrottle {
  const { policy } = input;
  const clock = input.clock ?? (() => Date.now());
  const store =
    input.store ??
    createMemoryThrottleStore({
      maxEntries: policy.store.maxEntries,
      ttlMs: policy.store.ttlMs,
      clock,
    });

  function recordIntoBucket(
    key: string,
    bucketPolicy: { max: number; windowMs: number; lockMs: number },
    nowMs: number,
  ): void {
    const existing = store.get(key);
    const locked = existing !== undefined && existing.lockedUntilMs > nowMs;
    if (locked) return; // already locked; concurrent attempts cannot extend it
    const windowExpired =
      existing !== undefined && nowMs - existing.windowStartMs > bucketPolicy.windowMs;
    // A finished lock starts a fresh budget instead of re-locking on the first failure.
    const lockReleased =
      existing !== undefined &&
      existing.lockedUntilMs > 0 &&
      existing.lockedUntilMs <= nowMs;
    if (!existing || windowExpired || lockReleased) {
      store.set(key, {
        failures: 1,
        windowStartMs: nowMs,
        lockedUntilMs: bucketPolicy.max <= 1 ? nowMs + bucketPolicy.lockMs : 0,
      });
      return;
    }
    const failures = existing.failures + 1;
    store.set(key, {
      failures,
      windowStartMs: existing.windowStartMs,
      lockedUntilMs:
        failures >= bucketPolicy.max ? nowMs + bucketPolicy.lockMs : 0,
    });
  }

  return {
    policy,
    sourceFor(request) {
      return clientSourceFromRequest(request, policy.trustedProxyHops);
    },
    check({ username, source }) {
      if (!policy.enabled) return { allowed: true, storeError: false };
      const keys: string[] = [accountThrottleKey(username)];
      if (source) keys.push(sourceThrottleKey(source));
      try {
        const nowMs = clock();
        const accountBucket = store.get(keys[0]);
        const sourceBucket = keys.length > 1 ? store.get(keys[1]) : undefined;
        const accountLocked = accountBucket ? accountBucket.lockedUntilMs > nowMs : false;
        const sourceLocked = sourceBucket ? sourceBucket.lockedUntilMs > nowMs : false;
        if (!accountLocked && !sourceLocked) {
          return { allowed: true, storeError: false };
        }
        const scope: ThrottleScope =
          accountLocked && sourceLocked ? "both" : accountLocked ? "account" : "source";
        return {
          allowed: false,
          storeError: false,
          scope,
          retryAfterSecondsBucket: retryAfterSecondsBucket(
            lockRetrySeconds(accountLocked ? accountBucket : undefined, sourceLocked ? sourceBucket : undefined, nowMs),
          ),
        };
      } catch {
        if (!policy.failOpen) {
          return {
            allowed: false,
            storeError: true,
            scope: "account",
            retryAfterSecondsBucket: 60,
          };
        }
        return { allowed: true, storeError: true };
      }
    },
    recordFailure({ username, source }) {
      if (!policy.enabled) return { storeError: false };
      try {
        const nowMs = clock();
        recordIntoBucket(accountThrottleKey(username), policy.account, nowMs);
        if (source) recordIntoBucket(sourceThrottleKey(source), policy.source, nowMs);
        return { storeError: false };
      } catch {
        return { storeError: true };
      }
    },
    recordSuccess({ username }) {
      if (!policy.enabled) return { storeError: false };
      try {
        // Only the account budget is reset. The source budget keeps its abuse
        // history so a successful login cannot clear source-level throttling.
        store.delete(accountThrottleKey(username));
        return { storeError: false };
      } catch {
        return { storeError: true };
      }
    },
    storeSize() {
      try {
        return store.size();
      } catch {
        return 0;
      }
    },
  };
}

export type LoginAttemptProvider = "legacy" | "v2";
export type LoginAttemptOutcome = "success" | "failure";
export type LoginAttemptReason =
  | "ok"
  | "missing_credentials"
  | "unknown_user"
  | "wrong_password"
  | "inactive"
  | "membership_denied"
  | "throttled"
  | "store_error"
  | "internal_error";

/** Failure reasons that consume the failure budget. */
export type LoginVerifyFailureReason =
  | "missing_credentials"
  | "unknown_user"
  | "wrong_password"
  | "inactive"
  | "membership_denied";

export type LoginVerifyResult<T> =
  | { outcome: "success"; value: T }
  | { outcome: "failure"; reason: LoginVerifyFailureReason }
  | { outcome: "error"; error: unknown };

export type GuardCredentialsLoginInput<T> = {
  provider: LoginAttemptProvider;
  username: string;
  request: Request | undefined;
  throttle: LoginThrottle;
  /** False when the submitted password is empty: the attempt is rejected before throttling. */
  hasPassword?: boolean;
  verify: () => Promise<LoginVerifyResult<T>>;
  onAttempt: (input: {
    outcome: LoginAttemptOutcome;
    reason: LoginAttemptReason;
    error?: unknown;
  }) => void;
  onThrottled: (input: {
    scope: ThrottleScope;
    retryAfterSecondsBucket: RetryAfterSecondsBucket;
  }) => void;
  onStoreError: () => void;
};

const THROTTLEABLE_FAILURE_REASONS: ReadonlySet<LoginVerifyFailureReason> = new Set([
  "unknown_user",
  "wrong_password",
  "inactive",
  "membership_denied",
]);

/**
 * Unified credentials gate. External results stay identical for unknown user,
 * wrong password and inactive account: all return `null` under the threshold.
 * Only an exhausted throttle throws (a `CredentialsSignin` subclass) and that
 * throw is identical for every account.
 */
export async function guardCredentialsLogin<T>(
  input: GuardCredentialsLoginInput<T>,
): Promise<T | null> {
  const { throttle } = input;
  const accountThrottleable =
    input.hasPassword !== false && normalizeAccountIdentifier(input.username).length > 0;
  const source = accountThrottleable ? throttle.sourceFor(input.request) : null;
  let storeError = false;

  if (accountThrottleable) {
    const check = throttle.check({ username: input.username, source });
    storeError = storeError || check.storeError;
    if (!check.allowed) {
      input.onAttempt({ outcome: "failure", reason: "throttled" });
      input.onThrottled({
        scope: check.scope,
        retryAfterSecondsBucket: check.retryAfterSecondsBucket,
      });
      if (storeError) input.onStoreError();
      throw new LoginThrottledError();
    }
  }

  const result = await input.verify();

  if (result.outcome === "error") {
    input.onAttempt({ outcome: "failure", reason: "internal_error", error: result.error });
    if (storeError) input.onStoreError();
    throw result.error;
  }

  if (result.outcome === "failure") {
    if (accountThrottleable && THROTTLEABLE_FAILURE_REASONS.has(result.reason)) {
      const recorded = throttle.recordFailure({ username: input.username, source });
      storeError = storeError || recorded.storeError;
    }
    input.onAttempt({ outcome: "failure", reason: result.reason });
    if (storeError) input.onStoreError();
    return null;
  }

  if (accountThrottleable) {
    const recorded = throttle.recordSuccess({ username: input.username });
    storeError = storeError || recorded.storeError;
  }
  input.onAttempt({ outcome: "success", reason: "ok" });
  if (storeError) input.onStoreError();
  return result.value;
}


