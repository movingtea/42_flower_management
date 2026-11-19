import { describe, expect, it } from "vitest";
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
  ensureRequestId,
  getIncomingRequestId,
  isValidRequestId,
} from "./request-id";

describe("request ID format", () => {
  it("uses the agreed header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("accepts 8-64 characters from the [A-Za-z0-9._-] alphabet", () => {
    for (const value of [
      "abcdefgh",
      "req-1234_abcd.ef",
      "A".repeat(64),
      "01234567-89ab-cdef-0123-456789abcdef",
    ]) {
      expect(isValidRequestId(value), value).toBe(true);
      expect(REQUEST_ID_PATTERN.test(value), value).toBe(true);
    }
  });

  it("rejects short, overlong, control-character and non-string values", () => {
    for (const value of [
      undefined,
      null,
      12345678,
      {},
      "",
      "short7x",
      "A".repeat(65),
      "has space",
      "line\nbreak",
      "tab\tchar",
      "请求-12345678",
      "semi;colon",
      "slash/value",
    ]) {
      expect(isValidRequestId(value), String(value)).toBe(false);
    }
  });
});

describe("ensureRequestId", () => {
  it("preserves a valid inbound ID", () => {
    expect(ensureRequestId("request-12345678")).toBe("request-12345678");
    expect(ensureRequestId("A".repeat(64))).toBe("A".repeat(64));
  });

  it("replaces invalid or missing IDs with a fixed-length UUID", () => {
    for (const value of [undefined, null, "", "short7x", "bad value", "A".repeat(65)]) {
      const generated = ensureRequestId(value);
      expect(generated).toMatch(REQUEST_ID_PATTERN);
      expect(generated).toHaveLength(36);
    }
  });

  it("generates high-entropy, non-repeating IDs", () => {
    const generated = new Set(Array.from({ length: 1000 }, () => ensureRequestId()));
    expect(generated.size).toBe(1000);
  });
});

describe("getIncomingRequestId", () => {
  it("reads the header from a Headers object and preserves a valid value", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "inbound-12345678" });
    expect(getIncomingRequestId(headers)).toBe("inbound-12345678");
    // Header lookup is case-insensitive.
    expect(getIncomingRequestId(new Headers({ "X-Request-Id": "inbound-87654321" }))).toBe(
      "inbound-87654321",
    );
  });

  it("replaces an invalid or missing header", () => {
    expect(getIncomingRequestId(new Headers())).toMatch(REQUEST_ID_PATTERN);
    // A real Headers object rejects control characters, so exercise the guard with a stub
    // that can still hand back an illegal value from an untrusted upstream.
    const controlCharHeaders = {
      get: (name: string) =>
        name.toLowerCase() === REQUEST_ID_HEADER ? "bad\nvalue" : null,
    };
    expect(getIncomingRequestId(controlCharHeaders)).toMatch(REQUEST_ID_PATTERN);
    const throwingHeaders = {
      get: () => {
        throw new Error("headers unavailable");
      },
    };
    expect(getIncomingRequestId(throwingHeaders)).toMatch(REQUEST_ID_PATTERN);
  });

  it("keeps concurrent requests isolated", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        await new Promise((resolve) => setTimeout(resolve, index % 3));
        const inbound = `concurrent-request-${index}`;
        return getIncomingRequestId(new Headers({ [REQUEST_ID_HEADER]: inbound }));
      }),
    );
    expect(new Set(results).size).toBe(20);
    results.forEach((value, index) => expect(value).toBe(`concurrent-request-${index}`));
  });
});
