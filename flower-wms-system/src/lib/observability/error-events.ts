/**
 * Sanitized, correlatable server error events (Sprint E3.3 `e33-error-alerting`).
 *
 * The module turns a caught server error into one structured `error.server`
 * event and hands it to a local delivery adapter:
 *
 * - the event only carries deployment metadata, the validated request ID, the
 *   route template, the route type, the error name/code/digest, a stable
 *   group key and redacted stack frames;
 * - raw request headers, cookies, query strings, request bodies, SQL
 *   parameters, database URLs and error messages are never copied into the
 *   event. The leading stack line (which repeats the error message) is dropped
 *   and the remaining frames go through `redactSensitiveSubstrings`;
 * - delivery defaults to one JSON line on stderr. `ERROR_EVENT_FILE` appends to
 *   a file instead, which is how the local controlled-failure evidence is
 *   collected without a tracing platform.
 *
 * Delivery never changes a business result: I/O failures are reported as an
 * `error.delivery.failed` log event. `ERROR_EVENT_FAIL=1` is a test-only switch
 * that makes the adapter throw so the caller path for a broken tracing SDK can
 * be verified; `recordServerError` catches it and keeps the application alive.
 */
import { appendFileSync } from "node:fs";
import {
  classifyError,
  errorName,
  type ErrorClassification,
} from "./error-classify";
import { logEvent } from "./logger";
import { isValidRequestId, REQUEST_ID_HEADER } from "./request-id";
import { redactSensitiveSubstrings } from "./redact";

export const ERROR_EVENT_SCHEMA_VERSION = 1 as const;
export const ERROR_EVENT_NAME = "error.server";
export const ERROR_DELIVERY_FAILED_EVENT = "error.delivery.failed";
export const ERROR_EVENT_FILE_ENV = "ERROR_EVENT_FILE";
export const ERROR_EVENT_FAIL_ENV = "ERROR_EVENT_FAIL";

const SERVICE_NAME = "flower-wms";
const MAX_STACK_BYTES = 8 * 1024;
const MAX_ROUTE_PATH_LENGTH = 200;
const MAX_GROUP_KEY_LENGTH = 300;
const MAX_DIGEST_LENGTH = 128;
const MAX_ERROR_NAME_LENGTH = 80;
const MAX_ERROR_CODE_LENGTH = 64;

/** Route types reported by Next.js `onRequestError`. */
export type RouteType = "render" | "route" | "action" | "proxy" | "unknown";

export type ErrorEventHeaders =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

/** The `request` argument of Next.js `onRequestError` (path is intentionally unused). */
export interface ErrorEventRequest {
  path?: string;
  method?: string;
  headers?: ErrorEventHeaders;
}

/** The `context` argument of Next.js `onRequestError` plus normalised values. */
export interface ErrorEventContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  revalidateReason?: string;
}

export interface ErrorEventFields {
  kind: "system";
  reason: string;
  /** Route template, e.g. `/api/miniprogram/home-banners` (never a URL with query). */
  route: string;
  routeType: RouteType;
  errorName: string;
  errorCode?: string;
  /** `<errorName>:<errorCode|unknown>:<routePath>` — stable, low cardinality. */
  groupKey: string;
  digest?: string;
  /** Redacted stack frames only; the message line is dropped. */
  stack?: string;
}

/** Fixed log-line shaped event; the same envelope as the E3.1 structured log. */
export interface ErrorEvent {
  v: typeof ERROR_EVENT_SCHEMA_VERSION;
  ts: string;
  level: "error";
  event: typeof ERROR_EVENT_NAME;
  service: string;
  env: string;
  version: string;
  requestId?: string;
  fields: ErrorEventFields;
}

export type ErrorDeliveryAdapter = "stderr" | "file";

export interface ErrorDeliveryResult {
  delivered: boolean;
  adapter: ErrorDeliveryAdapter;
  /** Stable failure reason only; never a raw filesystem path or message. */
  reason?: string;
}

export interface ServerErrorResult {
  classification: ErrorClassification;
  event?: ErrorEvent;
  delivered: boolean;
  deliveryFailed: boolean;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function environmentName(): string {
  return firstNonEmpty(process.env.APP_ENV, process.env.NODE_ENV) ?? "unknown";
}

function sourceVersion(): string {
  return firstNonEmpty(process.env.APP_VERSION, process.env.GIT_SHA) ?? "unknown";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return readString((value as Record<string, unknown>)[key]);
}

/** Keep one fixed, short token; everything else collapses to `_`. */
function sanitizeToken(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const cleaned = trimmed.replace(/[^A-Za-z0-9_.:$/-]/g, "_").slice(0, maxLength);
  return cleaned === "" ? undefined : cleaned;
}

/** Route template only: no query string, fragment, control characters or IDs. */
export function sanitizeRoutePath(routePath: unknown): string {
  if (typeof routePath !== "string") return "unknown";
  const withoutQuery = routePath.split(/[?#]/, 1)[0] ?? "";
  const cleaned = withoutQuery
    .replace(/[^A-Za-z0-9._/\[\]-]/g, "_")
    .slice(0, MAX_ROUTE_PATH_LENGTH);
  return cleaned === "" || cleaned === "_" ? "unknown" : cleaned;
}

/** Only the four documented Next.js route types are accepted. */
export function normalizeRouteType(routeType: unknown): RouteType {
  return routeType === "render" ||
    routeType === "route" ||
    routeType === "action" ||
    routeType === "proxy"
    ? routeType
    : "unknown";
}

function sanitizeDigest(digest: unknown): string | undefined {
  const value = readString(digest)?.trim();
  if (value === undefined) return undefined;
  // Next.js digests are hex hashes or `NEXT_*` control-flow markers. Anything
  // else (e.g. a redirect digest that embeds a destination URL) is dropped.
  return /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value.slice(0, MAX_DIGEST_LENGTH) : undefined;
}

function sanitizeErrorName(value: string): string {
  return sanitizeToken(value, MAX_ERROR_NAME_LENGTH) ?? "ThrownValue";
}

function sanitizeErrorCode(value: string | undefined): string | undefined {
  return sanitizeToken(value, MAX_ERROR_CODE_LENGTH);
}

function groupKeyFor(
  name: string,
  code: string | undefined,
  route: string,
): string {
  return `${name}:${code ?? "unknown"}:${route}`.slice(0, MAX_GROUP_KEY_LENGTH);
}

function readHeader(
  headers: ErrorEventHeaders | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  try {
    const getter = (headers as { get?: unknown }).get;
    if (typeof getter === "function") {
      const value = (getter as (key: string) => string | null).call(headers, name);
      return typeof value === "string" ? value : undefined;
    }
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== lowerName) continue;
      return Array.isArray(value) ? value[0] : value;
    }
  } catch {
    // Header access is best effort; never let it break error reporting.
  }
  return undefined;
}

/**
 * Read the E3.2 request ID from the error request headers.
 *
 * An inbound value is only accepted when it already matches the request-ID
 * contract, so an arbitrary/oversized client header can never be echoed into an
 * error event.
 */
export function extractRequestId(
  request: ErrorEventRequest | null | undefined,
): string | undefined {
  const value = readHeader(request?.headers, REQUEST_ID_HEADER);
  return isValidRequestId(value) ? value : undefined;
}

/**
 * Safe stack: drop the leading message line (error messages can embed request
 * input), redact credentials/connection details in the frames, truncate.
 */
function safeStack(error: unknown): string | undefined {
  if (process.env.LOG_STACKS === "false") return undefined;
  const stack = readStringProperty(error, "stack");
  if (stack === undefined) return undefined;

  const lines = stack.split(/\r?\n/);
  const frames = lines.slice(1).join("\n").trim();
  if (frames === "") return undefined;

  const redacted = redactSensitiveSubstrings(frames);
  if (new TextEncoder().encode(redacted).length <= MAX_STACK_BYTES) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_STACK_BYTES)}\n[stack truncated]`;
}

/** Stable failure reason for a delivery problem; no paths, messages or hosts. */
export function safeDeliveryFailureReason(cause: unknown): string {
  const code = readStringProperty(cause, "code");
  const sanitizedCode = sanitizeToken(code, MAX_ERROR_CODE_LENGTH);
  if (sanitizedCode !== undefined) return sanitizedCode;
  const name = readStringProperty(cause, "name");
  const sanitizedErrorName = sanitizeToken(name, MAX_ERROR_NAME_LENGTH);
  return sanitizedErrorName ?? "delivery_error";
}

/** `ERROR_EVENT_FILE` selects the append-to-file adapter; otherwise stderr. */
export function resolveDeliveryAdapter(): ErrorDeliveryAdapter {
  return firstNonEmpty(process.env[ERROR_EVENT_FILE_ENV]) === undefined
    ? "stderr"
    : "file";
}

/**
 * Build the sanitized `error.server` event.
 *
 * The request path is deliberately not used: it contains the query string and
 * dynamic IDs. Only the validated `x-request-id` header is read.
 */
export function buildErrorEvent(
  error: unknown,
  request?: ErrorEventRequest | null,
  context?: ErrorEventContext | null,
  classification?: ErrorClassification,
): ErrorEvent {
  const route = sanitizeRoutePath(context?.routePath);
  const routeType = normalizeRouteType(context?.routeType);
  const resolvedClassification =
    classification ??
    classifyError(error, {
      routePath: route,
      routeType,
      digest: readStringProperty(error, "digest"),
    });

  const name = sanitizeErrorName(
    firstNonEmpty(resolvedClassification.name, errorName(error)) ?? "ThrownValue",
  );
  const code = sanitizeErrorCode(resolvedClassification.code);
  const digest = sanitizeDigest(
    readStringProperty(error, "digest") ?? resolvedClassification.digest,
  );
  const stack = safeStack(error);
  const requestId = extractRequestId(request);

  return {
    v: ERROR_EVENT_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    level: "error",
    event: ERROR_EVENT_NAME,
    service: SERVICE_NAME,
    env: environmentName(),
    version: sourceVersion(),
    ...(requestId === undefined ? {} : { requestId }),
    fields: {
      kind: "system",
      reason: resolvedClassification.reason,
      route,
      routeType,
      errorName: name,
      ...(code === undefined ? {} : { errorCode: code }),
      groupKey: groupKeyFor(name, code, route),
      ...(digest === undefined ? {} : { digest }),
      ...(stack === undefined ? {} : { stack }),
    },
  };
}

/**
 * Deliver one error event.
 *
 * Default: a single JSON line on stderr. `ERROR_EVENT_FILE` set: append the
 * same line to that file. Returns a result instead of throwing for I/O and
 * serialization failures; `ERROR_EVENT_FAIL=1` intentionally throws to let the
 * caller exercise the "tracing SDK is broken, application keeps running" path.
 */
export function deliverErrorEvent(event: ErrorEvent): ErrorDeliveryResult {
  const adapter = resolveDeliveryAdapter();

  if (process.env[ERROR_EVENT_FAIL_ENV] === "1") {
    // Test-only controlled failure. Callers must catch it and log
    // `error.delivery.failed`; it must never escape into a business path.
    throw new Error("forced error-event delivery failure (ERROR_EVENT_FAIL=1)");
  }

  try {
    const line = `${JSON.stringify(event)}\n`;
    if (adapter === "file") {
      const file = firstNonEmpty(process.env[ERROR_EVENT_FILE_ENV]);
      if (file === undefined) {
        return { delivered: false, adapter, reason: "missing_file_path" };
      }
      appendFileSync(file, line, { encoding: "utf8", flag: "a" });
      return { delivered: true, adapter };
    }
    process.stderr.write(line);
    return { delivered: true, adapter };
  } catch (cause) {
    return {
      delivered: false,
      adapter,
      reason: safeDeliveryFailureReason(cause),
    };
  }
}

function logDeliveryFailure(adapter: string, reason: string): void {
  logEvent({
    level: "error",
    event: ERROR_DELIVERY_FAILED_EVENT,
    fields: { adapter, reason },
  });
}

/**
 * Classify, filter and (for system errors only) deliver one server error.
 *
 * - expected error: debug-level `error.server` log line only (countable, never
 *   an alert-level event), no delivery;
 * - system error: sanitized event delivered through the local adapter; delivery
 *   problems become an `error.delivery.failed` event and never throw.
 *
 * Exported separately from `instrumentation.ts` so the whole contract is
 * unit-testable without starting Next.js.
 */
export function recordServerError(
  error: unknown,
  request?: ErrorEventRequest | null,
  context?: ErrorEventContext | null,
): ServerErrorResult {
  try {
    const route = sanitizeRoutePath(context?.routePath);
    const routeType = normalizeRouteType(context?.routeType);
    const classification = classifyError(error, {
      routePath: route,
      routeType,
      digest: readStringProperty(error, "digest"),
    });

    if (classification.kind === "expected") {
      const code = sanitizeErrorCode(classification.code);
      const name = sanitizeErrorName(classification.name);
      const digest = sanitizeDigest(classification.digest);
      logEvent({
        level: "debug",
        event: ERROR_EVENT_NAME,
        requestId: extractRequestId(request),
        fields: {
          kind: "expected",
          reason: classification.reason,
          route,
          routeType,
          errorName: name,
          ...(code === undefined ? {} : { errorCode: code }),
          groupKey: groupKeyFor(name, code, route),
          ...(digest === undefined ? {} : { digest }),
        },
      });
      return { classification, delivered: false, deliveryFailed: false };
    }

    const event = buildErrorEvent(error, request, context, classification);
    try {
      const delivery = deliverErrorEvent(event);
      if (delivery.delivered) {
        return { classification, event, delivered: true, deliveryFailed: false };
      }
      logDeliveryFailure(delivery.adapter, delivery.reason ?? "delivery_error");
      return {
        classification,
        event,
        delivered: false,
        deliveryFailed: true,
      };
    } catch (cause) {
      logDeliveryFailure(
        resolveDeliveryAdapter(),
        safeDeliveryFailureReason(cause),
      );
      return {
        classification,
        event,
        delivered: false,
        deliveryFailed: true,
      };
    }
  } catch {
    // The error-reporting path must never throw into the business request.
    return {
      classification: { kind: "system", reason: "unclassified", name: "ThrownValue" },
      delivered: false,
      deliveryFailed: false,
    };
  }
}
