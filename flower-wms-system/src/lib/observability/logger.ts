/**
 * Structured logger with a fixed, versioned JSON-line schema (Sprint E3.1).
 *
 * One record per event:
 *   {"v":1,"ts":"<UTC ISO>","level":"info","event":"cron.task.round",
 *    "service":"flower-wms","env":"...","version":"...",
 *    "requestId":"...","runId":"...","fields":{...},"err":{...}}
 *
 * `logEvent` is best effort by design: serialization, redaction and sink writes
 * are all shielded so a logging problem can never change a business result.
 * Correlation IDs are taken from the explicit input first and then from the
 * async log context so an HTTP request or cron task stays consistent.
 */
import { getLogContext } from "./context";
import { redactSensitiveSubstrings, redactText, redactValue } from "./redact";
import { getLogSink } from "./sink";

export { setLogSink } from "./sink";
export type { LogSink } from "./sink";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEventInput {
  level: LogLevel;
  event: string;
  fields?: Record<string, unknown>;
  requestId?: string;
  runId?: string;
  error?: unknown;
}

export interface SerializedError {
  name: string;
  code?: string;
  message?: string;
  digest?: string;
  stack?: string;
}

export interface LogRecord {
  v: 1;
  ts: string;
  level: LogLevel;
  event: string;
  service: string;
  env: string;
  version: string;
  requestId?: string;
  runId?: string;
  fields: Record<string, unknown>;
  err?: SerializedError;
}

const SERVICE_NAME = "flower-wms";
const LOG_SCHEMA_VERSION = 1 as const;
const MAX_STACK_BYTES = 8 * 1024;
const MAX_CORRELATION_ID_LENGTH = 128;
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/** APP_ENV (staging/production) wins over NODE_ENV; both are deployment metadata, never secrets. */
function environmentName(): string {
  return firstNonEmpty(process.env.APP_ENV, process.env.NODE_ENV) ?? "unknown";
}

function sourceVersion(): string {
  return firstNonEmpty(process.env.APP_VERSION, process.env.GIT_SHA) ?? "unknown";
}

function normalizeLevel(level: unknown): LogLevel {
  return LOG_LEVELS.includes(level as LogLevel) ? (level as LogLevel) : "info";
}

function normalizeEvent(event: unknown): string {
  return typeof event === "string" && event.trim() !== "" ? event.trim() : "log.event";
}

function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.slice(0, MAX_CORRELATION_ID_LENGTH);
}

function truncateStack(stack: string): string {
  if (stack.length <= MAX_STACK_BYTES) return stack;
  return `${stack.slice(0, MAX_STACK_BYTES)}\n[stack truncated]`;
}

/** Keep only the safe, stable Error fields; never the wrapped object graph. */
function serializeError(error: unknown, level: LogLevel): SerializedError | undefined {
  if (error === undefined || error === null) return undefined;

  const candidate =
    typeof error === "object"
      ? (error as {
          name?: unknown;
          message?: unknown;
          code?: unknown;
          digest?: unknown;
          stack?: unknown;
        })
      : null;

  const name =
    candidate && typeof candidate.name === "string" && candidate.name !== ""
      ? candidate.name
      : error instanceof Error
        ? "Error"
        : "ThrownValue";

  const serialized: SerializedError = { name };

  if (candidate && typeof candidate.code === "string") {
    serialized.code = redactText(candidate.code);
  } else if (candidate && typeof candidate.code === "number") {
    serialized.code = String(candidate.code);
  }

  const message =
    candidate && typeof candidate.message === "string"
      ? candidate.message
      : typeof error === "string"
        ? error
        : undefined;
  if (message !== undefined) serialized.message = redactText(message);

  if (candidate && typeof candidate.digest === "string") {
    serialized.digest = redactText(candidate.digest);
  }

  if (
    level === "error" &&
    process.env.LOG_STACKS !== "false" &&
    candidate &&
    typeof candidate.stack === "string"
  ) {
    serialized.stack = truncateStack(redactSensitiveSubstrings(candidate.stack));
  }

  return serialized;
}

function normalizeFields(fields: unknown): Record<string, unknown> {
  const redacted = redactValue(fields ?? {});
  return redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

/** Build the fixed-schema record. Exported only through the barrel for contract tests. */
export function buildLogRecord(input: LogEventInput): LogRecord {
  const context = getLogContext();
  const requestId =
    normalizeCorrelationId(input.requestId) ?? normalizeCorrelationId(context.requestId);
  const runId = normalizeCorrelationId(input.runId) ?? normalizeCorrelationId(context.runId);
  const level = normalizeLevel(input.level);

  const record: LogRecord = {
    v: LOG_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    level,
    event: normalizeEvent(input.event),
    service: SERVICE_NAME,
    env: environmentName(),
    version: sourceVersion(),
    ...(requestId === undefined ? {} : { requestId }),
    ...(runId === undefined ? {} : { runId }),
    fields: normalizeFields(input.fields),
  };

  const err = serializeError(input.error, level);
  if (err !== undefined) record.err = err;

  return record;
}

/** Emit one structured log event. Never throws. */
export function logEvent(input: LogEventInput): void {
  try {
    // LogSink is intentionally schema-agnostic, so the validated record is passed as a plain object.
    getLogSink()(buildLogRecord(input) as unknown as Record<string, unknown>);
  } catch {
    // Redaction, serialization and sink failures are contained by contract:
    // observability must never change the result of the operation it observes.
  }
}

/** Create a logger that always carries the given correlation IDs. */
export function createLogger(
  bindings: Partial<Pick<LogEventInput, "requestId" | "runId">> = {},
): { logEvent(input: Omit<LogEventInput, "requestId" | "runId">): void } {
  return {
    logEvent(input) {
      logEvent({ ...input, requestId: bindings.requestId, runId: bindings.runId });
    },
  };
}
