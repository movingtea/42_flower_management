/**
 * Request ID contract for Sprint E3.2.
 *
 * The same `x-request-id` header is used on the inbound request and on the
 * response. A trustworthy inbound value (8-64 chars of `[A-Za-z0-9._-]`) is
 * preserved so a caller or upstream proxy can correlate; anything else is
 * replaced with a fresh UUID. The value is correlation metadata only: it must
 * never be used for authorization, idempotency or metric labels.
 */
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

/** Accepted inbound format: short, fixed alphabet, no control characters. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

/** Keep a valid inbound ID, otherwise generate a high-quality UUID. */
export function ensureRequestId(value?: string | null): string {
  return isValidRequestId(value) ? value : randomUUID();
}

/** Read the inbound header, returning a validated ID or a fresh one. */
export function getIncomingRequestId(headers: {
  get(name: string): string | null;
}): string {
  try {
    return ensureRequestId(headers.get(REQUEST_ID_HEADER));
  } catch {
    return randomUUID();
  }
}
