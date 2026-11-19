/**
 * Error classification for Sprint E3.3 (`e33-error-alerting`).
 *
 * Server errors fall into two buckets:
 *
 * - `expected`: normal, client-caused or control-flow outcomes that must not
 *   page anyone, but still deserve a low-level count. This covers Auth.js
 *   `AuthError` / `CredentialsSignin` rejections (including the throttled
 *   subclass), Next.js control flow (`redirect()` / `notFound()` /
 *   `forbidden()` / `unauthorized()` digests), the stable business error codes
 *   from `src/lib/business-errors.ts` (validation and controlled business
 *   conflicts) and malformed JSON request bodies on route handlers.
 * - `system`: everything else, i.e. a bug or infrastructure failure. These are
 *   the only errors that become alert-level `error.server` events.
 *
 * Auth.js types are recognised structurally (`type`/`kind` are set by the
 * `AuthError` constructor, see `@auth/core/errors`) instead of importing
 * `next-auth` here: this module is pulled into the instrumentation bundle and a
 * static dependency on the auth runtime is unnecessary and runtime-specific.
 * `error-classify.vitest.ts` verifies the real Auth.js classes are matched.
 *
 * The stable business codes are mirrored in `BUSINESS_CODE_REASONS` below. The
 * `Record<BusinessErrorCode, ...>` type makes `npx tsc --noEmit` fail when
 * `src/lib/business-errors.ts` gains or renames a code, so the mirror cannot
 * drift silently. A value import is not used because `business-errors.ts`
 * imports `next/server` and `@/` aliases, which the Vitest runner cannot
 * resolve; type-only imports are erased and keep this module runtime-free.
 */
import type { BusinessErrorCode } from "../business-errors";

export type ErrorKind = "expected" | "system";

export type ExpectedErrorReason =
  | "auth_rejection"
  | "auth_throttled"
  | "next_redirect"
  | "next_not_found"
  | "next_http_error_fallback"
  | "next_control_flow"
  | "business_conflict"
  | "validation"
  | "invalid_request_body"
  | "permission_denied";

export type ErrorClassificationReason = ExpectedErrorReason | "unclassified";

/** Context the instrumentation layer knows about the failing request. */
export interface ErrorClassifyContext {
  /** Next.js error digest (`error.digest`); used to identify control flow. */
  digest?: string;
  /** Next.js route template, e.g. `/api/miniprogram/home-banners`. */
  routePath?: string;
  /** `render` | `route` | `action` | `proxy` (already normalised upstream). */
  routeType?: string;
}

export interface ErrorClassification {
  kind: ErrorKind;
  reason: ErrorClassificationReason;
  /** Stable error code: business code, Auth.js code or provider code. */
  code?: string;
  /** Error name only (`Error`, `PrismaClientInitializationError`, ...). */
  name: string;
  /** Next.js digest when the runtime attached one. */
  digest?: string;
}

/** Names of the Auth.js error family; instances also carry `type` + `kind`. */
const AUTH_ERROR_NAMES = new Set([
  "AuthError",
  "SignInError",
  "CredentialsSignin",
  "AdapterError",
  "CallbackRouteError",
]);

const CONTROL_FLOW_DIGESTS = new Set([
  "NEXT_NOT_FOUND",
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "DYNAMIC_SERVER_USAGE",
  "NEXT_PRERENDER_INTERRUPTED",
  "HANGING_PROMISE_REJECTION",
]);

/**
 * Stable `src/lib/business-errors.ts` codes mapped to the expected-error reason.
 *
 * `Record<BusinessErrorCode, ...>` is the compile-time parity check: a code that
 * is added or renamed in `business-errors.ts` breaks `tsc` until this map is
 * updated, so classification can never silently miss a business code.
 */
const BUSINESS_CODE_REASONS = {
  // Admin API codes
  PERMISSION_DENIED: "permission_denied",
  VALIDATION_ERROR: "validation",
  ENTITY_NOT_FOUND: "business_conflict",
  DUPLICATE_KEY: "business_conflict",
  INVALID_STATE_TRANSITION: "business_conflict",
  BUSINESS_RULE_VIOLATION: "business_conflict",
  // Mini program codes
  AUTH_REQUIRED: "permission_denied",
  PRODUCT_NOT_FOUND: "business_conflict",
  PRODUCT_OFF_SHELF: "business_conflict",
  SKU_NOT_FOUND: "business_conflict",
  SKU_INACTIVE: "business_conflict",
  INSUFFICIENT_STOCK: "business_conflict",
  INVALID_QUANTITY: "validation",
  PRICE_CHANGED: "business_conflict",
  INVALID_DELIVERY_DATE: "validation",
  BULK_ORDER_REQUIRES_PREORDER: "business_conflict",
  DELIVERY_SLOT_UNAVAILABLE: "business_conflict",
  CART_ITEM_UNAVAILABLE: "business_conflict",
  ORDER_NOT_FOUND: "business_conflict",
  ORDER_INVALID_STATE: "business_conflict",
  ORDER_EXPIRED: "business_conflict",
} as const satisfies Record<BusinessErrorCode, ExpectedErrorReason>;

const VALIDATION_ERROR_NAME_PATTERN =
  /(?:^|\.)(?:Validation|Zod)Error$/i;

const JSON_BODY_ERROR_PATTERN =
  /(?:json|body)/i;

const JSON_PARSE_ERROR_PATTERN =
  /unexpected|not valid json|end of json input|unexpected end/i;

function isKnownBusinessCode(code: string): code is BusinessErrorCode {
  return Object.hasOwn(BUSINESS_CODE_REASONS, code);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return readString((value as Record<string, unknown>)[key]);
}

/** Safe error name; never the message. */
export function errorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === "string" && error.name !== "") {
    return error.name;
  }
  const name = readStringProperty(error, "name");
  if (name) return name;
  return error instanceof Error ? "Error" : "ThrownValue";
}

/** `AuthError` and every subclass set a string `type` and `kind` in the constructor. */
export function isAuthJsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const type = readStringProperty(error, "type");
  const kind = readStringProperty(error, "kind");
  if (type !== undefined && kind !== undefined) return true;
  return AUTH_ERROR_NAMES.has(error.name);
}

/** Map a Next.js control-flow digest to its expected reason. */
export function classifyControlFlowDigest(
  digest: string,
): ExpectedErrorReason | null {
  if (digest.startsWith("NEXT_REDIRECT")) return "next_redirect";
  if (digest === "NEXT_NOT_FOUND") return "next_not_found";
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
    return digest === "NEXT_HTTP_ERROR_FALLBACK;404"
      ? "next_not_found"
      : "next_http_error_fallback";
  }
  if (CONTROL_FLOW_DIGESTS.has(digest)) return "next_control_flow";
  return null;
}

/** Resolve the expected reason for a stable business error code. */
export function classifyBusinessCode(code: string): ExpectedErrorReason {
  return isKnownBusinessCode(code)
    ? BUSINESS_CODE_REASONS[code]
    : "business_conflict";
}

/** Malformed JSON on a route handler is a client input problem, not an outage. */
function isMalformedJsonBody(
  error: unknown,
  context: ErrorClassifyContext,
): boolean {
  if (!(error instanceof SyntaxError)) return false;
  if (context.routeType !== "route") return false;
  const message = error.message;
  return (
    JSON_BODY_ERROR_PATTERN.test(message) &&
    JSON_PARSE_ERROR_PATTERN.test(message)
  );
}

/**
 * Classify a server error as expected or system.
 *
 * Always returns a value; never throws, whatever was thrown.
 */
export function classifyError(
  error: unknown,
  context: ErrorClassifyContext = {},
): ErrorClassification {
  try {
    const name = errorName(error);
    const digest = readStringProperty(error, "digest") ?? readString(context.digest);

    if (digest) {
      const controlFlowReason = classifyControlFlowDigest(digest);
      if (controlFlowReason) {
        return { kind: "expected", reason: controlFlowReason, name, digest };
      }
    }

    if (isAuthJsError(error)) {
      const code = readStringProperty(error, "code");
      const reason: ExpectedErrorReason =
        code === "too_many_attempts" ? "auth_throttled" : "auth_rejection";
      return {
        kind: "expected",
        reason,
        name,
        ...(code === undefined ? {} : { code }),
        ...(digest === undefined ? {} : { digest }),
      };
    }

    const code = readStringProperty(error, "code");
    if (code !== undefined && isKnownBusinessCode(code)) {
      return {
        kind: "expected",
        reason: classifyBusinessCode(code),
        name,
        code,
        ...(digest === undefined ? {} : { digest }),
      };
    }

    if (VALIDATION_ERROR_NAME_PATTERN.test(name)) {
      return {
        kind: "expected",
        reason: "validation",
        name,
        ...(digest === undefined ? {} : { digest }),
      };
    }

    if (isMalformedJsonBody(error, context)) {
      return {
        kind: "expected",
        reason: "invalid_request_body",
        name,
        ...(digest === undefined ? {} : { digest }),
      };
    }

    return {
      kind: "system",
      reason: "unclassified",
      name,
      ...(code === undefined ? {} : { code }),
      ...(digest === undefined ? {} : { digest }),
    };
  } catch {
    // Classification must never be the reason a request error is lost.
    return { kind: "system", reason: "unclassified", name: "ThrownValue" };
  }
}
