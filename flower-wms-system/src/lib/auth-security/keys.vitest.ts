import { describe, expect, it } from "vitest";
import {
  accountThrottleKey,
  clientSourceFromHeaders,
  clientSourceFromRequest,
  isValidForwardedAddress,
  normalizeAccountIdentifier,
  sourceThrottleKey,
} from "./keys";

describe("account throttle keys", () => {
  it("normalizes the account identifier like the providers do", () => {
    expect(normalizeAccountIdentifier("  Admin.One  ")).toBe("admin.one");
    expect(normalizeAccountIdentifier("ＡＤＭＩＮ")).not.toBe("admin");
  });

  it("produces a stable HMAC key and never the plaintext username", () => {
    const key = accountThrottleKey("admin");
    expect(key).toMatch(/^account:[0-9a-f]{16}$/u);
    expect(key).toBe(accountThrottleKey("  ADMIN "));
    expect(key).not.toContain("admin");
    expect(accountThrottleKey("manager")).not.toBe(key);
  });

  it("maps an empty username to its own bucket (guard skips it explicitly)", () => {
    expect(accountThrottleKey("")).toMatch(/^account:[0-9a-f]{16}$/u);
  });
});

describe("source throttle keys", () => {
  it("hashes the source address", () => {
    const key = sourceThrottleKey("203.0.113.9");
    expect(key).toMatch(/^source:[0-9a-f]{16}$/u);
    expect(key).not.toContain("203.0.113.9");
  });
});

describe("X-Forwarded-For parsing", () => {
  it("ignores the header entirely with zero trusted hops", () => {
    expect(clientSourceFromHeaders("203.0.113.9, 10.0.0.1", 0)).toBeNull();
    expect(clientSourceFromHeaders("203.0.113.9", -1)).toBeNull();
  });

  it("uses the address appended by the trusted proxy", () => {
    // Forged left-most entries must not win over the nginx-observed address.
    expect(clientSourceFromHeaders("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientSourceFromHeaders("6.6.6.6, 10.0.0.1, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientSourceFromHeaders("6.6.6.6, 10.0.0.1, 203.0.113.9", 2)).toBe("10.0.0.1");
  });

  it("rejects malformed entries and missing hops", () => {
    expect(clientSourceFromHeaders("", 1)).toBeNull();
    expect(clientSourceFromHeaders(null, 1)).toBeNull();
    expect(clientSourceFromHeaders("203.0.113.9", 2)).toBeNull();
    expect(clientSourceFromHeaders("not-an-ip", 1)).toBeNull();
    expect(clientSourceFromHeaders("203.0.113.9:443", 1)).toBeNull();
    expect(clientSourceFromHeaders("x".repeat(64), 1)).toBeNull();
    expect(clientSourceFromHeaders("6.6.6.6, <script>", 1)).toBeNull();
  });

  it("accepts IPv4 and bracketed/plain IPv6 addresses", () => {
    expect(isValidForwardedAddress("203.0.113.9")).toBe(true);
    expect(isValidForwardedAddress("::1")).toBe(true);
    expect(isValidForwardedAddress("[2001:db8::1]")).toBe(true);
    expect(isValidForwardedAddress("deadbeef")).toBe(false);
    expect(isValidForwardedAddress("")).toBe(false);
  });

  it("reads the header from a Request", () => {
    const request = new Request("https://example.com/api/auth/callback/v2-credentials", {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    });
    expect(clientSourceFromRequest(request, 1)).toBe("203.0.113.9");
    expect(clientSourceFromRequest(request, 0)).toBeNull();
    expect(clientSourceFromRequest(undefined, 1)).toBeNull();
  });
});
