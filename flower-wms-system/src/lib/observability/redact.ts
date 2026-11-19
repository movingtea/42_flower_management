/**
 * Field-level redaction for the structured log schema (Sprint E3.1).
 *
 * The redactor is deliberately defensive: log serialization must never throw
 * and must never copy a credential, cookie, token or connection string into a
 * log line.
 *
 * - Key matching is case-insensitive and ignores `_`/`-`, so `dbPassword`,
 *   `set-cookie` and `AUTH_SECRET` are all rejected.
 * - A string value that contains a database/redis URL or a bearer/basic
 *   credential is replaced as a whole by `[redacted]`.
 * - Recursion stops at a fixed depth, key count and array length, and cycles
 *   become `[circular]` instead of throwing.
 */
import { createHmac } from "node:crypto";

export const REDACTED = "[redacted]";
export const CIRCULAR = "[circular]";
export const DEPTH_LIMIT = "[depth-limit]";

export const MAX_REDACT_DEPTH = 6;
export const MAX_REDACT_KEYS = 100;
export const MAX_REDACT_ARRAY_ITEMS = 50;

/** Normalized (lowercase, `_`/`-` removed) key substrings that are never logged. */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|pass|secret|token|authorization|cookie|setcookie|apikey|apisecret|dsn|connectionstring|databaseurl|privatekey|credential|credentials|authsecret/i;

/** Whole-value replacement patterns (stateful `/g` is intentionally avoided). */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /postgres(?:ql)?:\/\//i,
  /mysql:\/\//i,
  /redis:\/\//i,
  /\bBearer\s+\S+/i,
  /\bBasic\s+\S+/i,
];

/** In-place replacement patterns used for stacks, where losing the whole stack is worse. */
const SENSITIVE_SUBSTRING_PATTERNS: readonly RegExp[] = [
  /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
  /mysql:\/\/[^\s"'`]+/gi,
  /redis:\/\/[^\s"'`]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=-]+/gi,
];

/**
 * Database connection details (host:port and Prisma/node-postgres wording) are
 * deployment information and must not reach a log line. The whole message is
 * replaced when it carries one of these; stacks are scrubbed in place so the
 * remaining frames stay usable.
 */
const CONNECTION_DETAIL_PATTERNS: readonly RegExp[] = [
  /\bCan't reach database server at\b[^\n]*/i,
  /\bconnection to server at\b[^\n]*?\bport \d+\b[^\n]*failed/i,
  /\bECONNREFUSED\b[^\n]*/i,
  /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b/i,
];

const CONNECTION_DETAIL_SUBSTRING_PATTERNS: readonly RegExp[] = [
  /\bCan't reach database server at\b[^\n]*/gi,
  /\bconnection to server at\b[^\n]*?\bport \d+\b[^\n]*failed/gi,
  /\bECONNREFUSED\b[^\n]*/gi,
  /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b/gi,
];

/** True when a field key would carry a credential or connection detail. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.toLowerCase().replace(/[_-]/g, ""));
}

/** True when the value carries a credential, connection URL or database host:port detail. */
export function isSensitiveText(value: string): boolean {
  return (
    SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
    CONNECTION_DETAIL_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/** Redact a single string value, replacing it entirely when it looks secret. */
export function redactText(value: string): string {
  return isSensitiveText(value) ? REDACTED : value;
}

/** Replace credential/connection substrings inside a longer text (stack traces). */
export function redactSensitiveSubstrings(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_SUBSTRING_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  for (const pattern of CONNECTION_DETAIL_SUBSTRING_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Recursively redact a log field value.
 *
 * Values are copied, never mutated. Non-JSON values are converted to safe
 * strings so the caller can always `JSON.stringify` the result.
 */
export function redactValue(
  value: unknown,
  depth = 0,
  ancestors: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return redactText(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
      return "[symbol]";
    case "function":
      return "[function]";
    default:
      break;
  }

  if (depth >= MAX_REDACT_DEPTH) return DEPTH_LIMIT;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return `[error:${value.name || "Error"}]`;

  const objectValue = value as object;
  if (ancestors.has(objectValue)) return CIRCULAR;

  ancestors.add(objectValue);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_REDACT_ARRAY_ITEMS)
        .map((item) => redactValue(item, depth + 1, ancestors));
    }

    const source = objectValue as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let copied = 0;
    for (const key of Object.keys(source)) {
      if (copied >= MAX_REDACT_KEYS) break;
      copied += 1;
      result[key] = isSensitiveKey(key)
        ? REDACTED
        : redactValue(source[key], depth + 1, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(objectValue);
  }
}

/**
 * Stable, non-reversible account fingerprint for authentication logs.
 *
 * `HMAC-SHA256(key = AUTH_SECRET || NEXTAUTH_SECRET || "e3-dev", normalizedUsername)`
 * truncated to 16 hex chars, per the Sprint E3 shared contract. The plaintext
 * username must never reach a log line.
 */
export function fingerprintAccount(username: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "e3-dev";
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  return createHmac("sha256", secret)
    .update(normalizedUsername)
    .digest("hex")
    .slice(0, 16);
}
