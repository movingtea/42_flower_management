/**
 * Sprint E3.6 auth-security barrel.
 *
 * `src/auth.ts` imports the concrete module path for hot paths; this barrel is
 * the documented surface for tooling, tests and future providers.
 */
export {
  DEFAULT_LOGIN_THROTTLE_POLICY,
  resolveLoginThrottlePolicy,
  type LoginThrottlePolicy,
} from "./policy";
export {
  accountThrottleKey,
  clientSourceFromHeaders,
  clientSourceFromRequest,
  isValidForwardedAddress,
  normalizeAccountIdentifier,
  sourceThrottleKey,
} from "./keys";
export {
  createMemoryThrottleStore,
  type MemoryThrottleStoreOptions,
  type ThrottleBucket,
  type ThrottleStateStore,
} from "./store";
export {
  LoginThrottledError,
  createLoginThrottle,
  guardCredentialsLogin,
  retryAfterSecondsBucket,
  type GuardCredentialsLoginInput,
  type LoginAttemptOutcome,
  type LoginAttemptProvider,
  type LoginAttemptReason,
  type LoginThrottle,
  type LoginThrottleCheck,
  type LoginThrottleRecordResult,
  type LoginVerifyFailureReason,
  type LoginVerifyResult,
  type RetryAfterSecondsBucket,
  type ThrottleScope,
} from "./throttle";
