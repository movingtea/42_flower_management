/**
 * Safe throttle keys for the Sprint E3.6 login throttle.
 *
 * Neither the account name nor a client address is ever stored or logged in
 * plaintext: both are reduced to a truncated HMAC fingerprint (the account
 * fingerprint helper is the shared E3 observability one, keyed by AUTH_SECRET).
 */
import { fingerprintAccount } from "../observability/redact";

/** Normalize an account name the same way the credentials providers do. */
export function normalizeAccountIdentifier(username: string): string {
  return String(username ?? "").trim().toLowerCase();
}

/** Stable, non-reversible account bucket key. Empty input still maps to one bucket. */
export function accountThrottleKey(username: string): string {
  return `account:${fingerprintAccount(normalizeAccountIdentifier(username))}`;
}

/**
 * Resolve the client address from `X-Forwarded-For` using the trusted-proxy
 * hop count.
 *
 * Each proxy appends the address it observed, so with `trustedProxyHops = 1`
 * (the single production nginx) the last entry is the nginx-observed address and
 * everything to its left is untrusted client input. With 0 hops the header is
 * ignored completely (local/staging direct connections).
 */
export function clientSourceFromHeaders(
  forwardForHeader: string | null | undefined,
  trustedProxyHops: number,
): string | null {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return null;
  if (typeof forwardForHeader !== "string" || forwardForHeader.trim() === "") return null;

  const entries = forwardForHeader.split(",").map((entry) => entry.trim());
  if (entries.length < trustedProxyHops) return null;
  const candidate = entries[entries.length - trustedProxyHops];
  if (!isValidForwardedAddress(candidate)) return null;
  return candidate;
}

/** Loose but bounded validation for an IPv4/IPv6 address (no ports, no hostnames). */
export function isValidForwardedAddress(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 45) return false;
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  if (!/^[0-9a-fA-F:.]+$/u.test(unwrapped)) return false;
  // Reject IPv4:port; a valid entry is an address only.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/u.test(unwrapped)) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(unwrapped);
  if (ipv4) {
    return ipv4.slice(1).every((octet) => Number(octet) <= 255);
  }
  return unwrapped.includes(":") && /[0-9]/u.test(unwrapped);
}

export function clientSourceFromRequest(
  request: Request | undefined,
  trustedProxyHops: number,
): string | null {
  if (!request) return null;
  return clientSourceFromHeaders(
    request.headers.get("x-forwarded-for"),
    trustedProxyHops,
  );
}

/** Stable, non-reversible source bucket key. The raw address is never persisted. */
export function sourceThrottleKey(source: string): string {
  return `source:${fingerprintAccount(source)}`;
}

