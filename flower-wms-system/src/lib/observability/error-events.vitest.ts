import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildErrorEvent,
  deliverErrorEvent,
  extractRequestId,
  normalizeRouteType,
  recordServerError,
  sanitizeRoutePath,
  type ErrorEvent,
} from "./error-events";
import type { LogRecord } from "./logger";
import { resetLogSink, setLogSink } from "./sink";

const MANAGED_ENV_KEYS = [
  "ERROR_EVENT_FILE",
  "ERROR_EVENT_FAIL",
  "LOG_STACKS",
  "APP_ENV",
  "APP_VERSION",
  "GIT_SHA",
  "NODE_ENV",
] as const;

type SavedEnv = Map<string, string | undefined>;

let records: LogRecord[] = [];
let tempDir = "";
let savedEnv: SavedEnv = new Map();

function saveEnv(): SavedEnv {
  const saved = new Map<string, string | undefined>();
  for (const key of MANAGED_ENV_KEYS) saved.set(key, process.env[key]);
  return saved;
}

function restoreEnv(saved: SavedEnv): void {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function readEventLines(file: string): ErrorEvent[] {
  const content = readFileSync(file, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ErrorEvent);
}

function systemError(): Error {
  return Object.assign(new Error("database exploded with secret-token"), {
    name: "PrismaClientInitializationError",
    code: "P1001",
    digest: "abc123def456",
  });
}

beforeEach(() => {
  records = [];
  savedEnv = saveEnv();
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
  tempDir = mkdtempSync(join(tmpdir(), "wms-e33-events-"));
  setLogSink((record) => {
    records.push(record as unknown as LogRecord);
  });
});

afterEach(() => {
  resetLogSink();
  restoreEnv(savedEnv);
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("buildErrorEvent: schema and correlation", () => {
  it("builds the fixed error.server envelope with environment, route and group key", () => {
    process.env.APP_ENV = "staging";
    process.env.APP_VERSION = "2026.11.11-abc1234";

    const event = buildErrorEvent(
      systemError(),
      {
        path: "/api/orders/123?token=query-secret",
        method: "POST",
        headers: {
          "x-request-id": "req-12345678",
          cookie: "next-auth.session-token=secret-cookie",
          authorization: "Bearer secret-authorization",
        },
      },
      { routePath: "/api/orders/[id]", routeType: "route" },
    );

    expect(event.v).toBe(1);
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
    expect(event.level).toBe("error");
    expect(event.event).toBe("error.server");
    expect(event.service).toBe("flower-wms");
    expect(event.env).toBe("staging");
    expect(event.version).toBe("2026.11.11-abc1234");
    expect(event.requestId).toBe("req-12345678");
    expect(event.fields).toEqual({
      kind: "system",
      reason: "unclassified",
      route: "/api/orders/[id]",
      routeType: "route",
      errorName: "PrismaClientInitializationError",
      errorCode: "P1001",
      groupKey: "PrismaClientInitializationError:P1001:/api/orders/[id]",
      digest: "abc123def456",
      stack: expect.any(String),
    });
  });

  it("never copies headers, cookies, query strings or the request path", () => {
    const event = buildErrorEvent(
      systemError(),
      {
        path: "/api/orders/123?token=query-secret",
        headers: {
          "x-request-id": "req-12345678",
          cookie: "next-auth.session-token=secret-cookie",
          authorization: "Bearer secret-authorization",
          "x-api-key": "secret-api-key",
        },
      },
      { routePath: "/api/orders/[id]", routeType: "route" },
    );
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("secret-cookie");
    expect(serialized).not.toContain("secret-authorization");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("/api/orders/123");
    expect(serialized).not.toContain("next-auth.session-token");
  });

  it("drops the error message from the stack and redacts connection details", () => {
    const error = new Error("Can't reach database server at localhost:5432/wms");
    error.stack = [
      "Error: Can't reach database server at localhost:5432/wms",
      "    at dbConnect (postgres://wms_user:wms_password@localhost:5432/wms)",
      "    at PrismaClient._request (localhost:5432)",
    ].join("\n");

    const event = buildErrorEvent(error, null, { routePath: "/api/health", routeType: "route" });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("wms_password");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("5432");
    expect(serialized).not.toContain("Can't reach database server");
    expect(serialized).toContain("[redacted]");
    expect(event.fields.stack).toContain("at dbConnect");
  });

  it("omits the stack when LOG_STACKS=false", () => {
    process.env.LOG_STACKS = "false";
    const event = buildErrorEvent(systemError());
    expect(event.fields.stack).toBeUndefined();
  });

  it("drops digests that could embed URLs and sanitizes route paths", () => {
    const redirectLike = Object.assign(new Error("redirect"), {
      digest: "NEXT_REDIRECT;replace;/v2?token=secret;307;",
    });
    const event = buildErrorEvent(redirectLike, null, { routePath: "/v2?token=secret" });
    expect(event.fields.digest).toBeUndefined();
    expect(event.fields.route).toBe("/v2");
  });

  it("keeps the group key stable across requests even when IDs differ", () => {
    const first = buildErrorEvent(systemError(), null, { routePath: "/api/orders/[id]" });
    const second = buildErrorEvent(systemError(), null, { routePath: "/api/orders/[id]" });
    expect(first.fields.groupKey).toBe(second.fields.groupKey);
  });

  it("handles non-Error thrown values without a stack", () => {
    const event = buildErrorEvent("plain string failure");
    expect(event.fields.errorName).toBe("ThrownValue");
    expect(event.fields.stack).toBeUndefined();
    expect(event.fields.groupKey).toBe("ThrownValue:unknown:unknown");
  });

  it("sanitizes odd error names and codes", () => {
    const error = Object.assign(new Error("x"), {
      name: "Weird Name/with:chars",
      code: "code with spaces",
    });
    const event = buildErrorEvent(error);
    expect(event.fields.errorName).toBe("Weird_Name/with:chars");
    expect(event.fields.errorCode).toBe("code_with_spaces");
  });
});

describe("request ID extraction", () => {
  it("accepts a valid x-request-id from plain header objects", () => {
    expect(
      extractRequestId({ headers: { "x-request-id": "req-12345678" } }),
    ).toBe("req-12345678");
    expect(
      extractRequestId({ headers: { "X-Request-Id": ["req-12345678"] } }),
    ).toBe("req-12345678");
  });

  it("accepts a Headers-like getter", () => {
    const headers = {
      get(name: string): string | null {
        return name === "x-request-id" ? "req-12345678" : null;
      },
    };
    expect(extractRequestId({ headers })).toBe("req-12345678");
  });

  it("never echoes invalid, oversized or control-character IDs", () => {
    expect(extractRequestId({ headers: { "x-request-id": "short" } })).toBeUndefined();
    expect(
      extractRequestId({ headers: { "x-request-id": "x".repeat(65) } }),
    ).toBeUndefined();
    expect(
      extractRequestId({ headers: { "x-request-id": "bad id with spaces" } }),
    ).toBeUndefined();
    expect(extractRequestId(null)).toBeUndefined();
    expect(extractRequestId(undefined)).toBeUndefined();
  });
});

describe("route sanitisation", () => {
  it("keeps templates and strips query strings", () => {
    expect(sanitizeRoutePath("/api/miniprogram/home-banners")).toBe(
      "/api/miniprogram/home-banners",
    );
    expect(sanitizeRoutePath("/app/blog/[dynamic]")).toBe("/app/blog/[dynamic]");
    expect(sanitizeRoutePath("/v2?callbackUrl=/secret")).toBe("/v2");
  });

  it("never returns an empty route and caps the length", () => {
    expect(sanitizeRoutePath("")).toBe("unknown");
    expect(sanitizeRoutePath(undefined)).toBe("unknown");
    expect(sanitizeRoutePath("?only-query")).toBe("unknown");
    expect(sanitizeRoutePath(`/${"a".repeat(500)}`)).toHaveLength(200);
  });

  it("normalises route types to the documented enum", () => {
    expect(normalizeRouteType("render")).toBe("render");
    expect(normalizeRouteType("action")).toBe("action");
    expect(normalizeRouteType("proxy")).toBe("proxy");
    expect(normalizeRouteType("route")).toBe("route");
    expect(normalizeRouteType("something-else")).toBe("unknown");
    expect(normalizeRouteType(undefined)).toBe("unknown");
  });
});

describe("deliverErrorEvent: local adapters", () => {
  it("writes one JSON line to stderr by default", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const event = buildErrorEvent(systemError());

    const result = deliverErrorEvent(event);

    expect(result).toEqual({ delivered: true, adapter: "stderr" });
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line) as ErrorEvent;
    expect(parsed.event).toBe("error.server");
    expect(parsed.level).toBe("error");
  });

  it("appends JSON lines to ERROR_EVENT_FILE", () => {
    const file = join(tempDir, "errors.jsonl");
    process.env.ERROR_EVENT_FILE = file;
    const first = buildErrorEvent(systemError(), null, { routePath: "/api/a" });
    const second = buildErrorEvent(systemError(), null, { routePath: "/api/b" });

    expect(deliverErrorEvent(first)).toEqual({ delivered: true, adapter: "file" });
    expect(deliverErrorEvent(second)).toEqual({ delivered: true, adapter: "file" });

    const events = readEventLines(file);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.fields.route)).toEqual(["/api/a", "/api/b"]);
  });

  it("returns a stable failure result when the file cannot be written", () => {
    const directory = join(tempDir, "not-a-file");
    mkdirSync(directory);
    process.env.ERROR_EVENT_FILE = directory;

    const result = deliverErrorEvent(buildErrorEvent(systemError()));

    expect(result.delivered).toBe(false);
    expect(result.adapter).toBe("file");
    expect(typeof result.reason).toBe("string");
    expect(result.reason).not.toContain(tempDir);
  });

  it("throws only for the test-only ERROR_EVENT_FAIL switch", () => {
    process.env.ERROR_EVENT_FAIL = "1";
    expect(() => deliverErrorEvent(buildErrorEvent(systemError()))).toThrow(
      /ERROR_EVENT_FAIL/,
    );
  });
});

describe("recordServerError: filtering and failure isolation", () => {
  it("filters expected errors to a debug-level log line without delivery", () => {
    const file = join(tempDir, "expected.jsonl");
    process.env.ERROR_EVENT_FILE = file;

    const result = recordServerError(
      Object.assign(new Error("invalid input"), { code: "VALIDATION_ERROR" }),
      { headers: { "x-request-id": "req-12345678" } },
      { routePath: "/api/admin/products", routeType: "route" },
    );

    expect(result.classification.kind).toBe("expected");
    expect(result.classification.reason).toBe("validation");
    expect(result.delivered).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe("debug");
    expect(records[0].event).toBe("error.server");
    expect(records[0].requestId).toBe("req-12345678");
    expect(asRecord(records[0].fields)).toMatchObject({
      kind: "expected",
      reason: "validation",
      route: "/api/admin/products",
      routeType: "route",
      errorName: "Error",
      errorCode: "VALIDATION_ERROR",
      groupKey: "Error:VALIDATION_ERROR:/api/admin/products",
    });
    expect(existsSync(file)).toBe(false);
  });

  it("delivers a system error as exactly one event and keeps the request ID", () => {
    const file = join(tempDir, "system.jsonl");
    process.env.ERROR_EVENT_FILE = file;

    const result = recordServerError(
      systemError(),
      { path: "/api/orders?token=secret", headers: { "x-request-id": "req-abcdefgh" } },
      { routePath: "/api/orders", routeType: "route" },
    );

    expect(result.classification.kind).toBe("system");
    expect(result.delivered).toBe(true);
    expect(result.deliveryFailed).toBe(false);
    expect(records).toHaveLength(0);

    const events = readEventLines(file);
    expect(events).toHaveLength(1);
    expect(events[0].requestId).toBe("req-abcdefgh");
    expect(events[0].fields.route).toBe("/api/orders");
    expect(JSON.stringify(events[0])).not.toContain("token=secret");
  });

  it("keeps the application alive and logs error.delivery.failed when the adapter throws", () => {
    process.env.ERROR_EVENT_FAIL = "1";

    const result = (() => recordServerError(systemError(), null, {
      routePath: "/api/health",
      routeType: "route",
    }))();

    expect(result.classification.kind).toBe("system");
    expect(result.delivered).toBe(false);
    expect(result.deliveryFailed).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe("error");
    expect(records[0].event).toBe("error.delivery.failed");
    expect(asRecord(records[0].fields).adapter).toBe("stderr");
    expect(typeof asRecord(records[0].fields).reason).toBe("string");
  });

  it("logs error.delivery.failed when the file adapter fails, without throwing", () => {
    const directory = join(tempDir, "dir");
    mkdirSync(directory);
    process.env.ERROR_EVENT_FILE = directory;

    const result = recordServerError(systemError());

    expect(result.deliveryFailed).toBe(true);
    expect(result.delivered).toBe(false);
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("error.delivery.failed");
    expect(asRecord(records[0].fields).adapter).toBe("file");
  });

  it("never throws, even for a hostile error object", () => {
    const hostile = {
      name: "HostileError",
      get stack(): string {
        throw new Error("stack getter exploded");
      },
    };
    expect(() => recordServerError(hostile)).not.toThrow();
    const result = recordServerError(hostile);
    expect(result.classification.kind).toBe("system");
  });

  it("treats Auth.js and control-flow errors as expected", () => {
    const authLike = Object.assign(new Error("auth"), {
      name: "CredentialsSignin",
      type: "CredentialsSignin",
      kind: "signIn",
      code: "credentials",
    });
    expect(recordServerError(authLike).classification.kind).toBe("expected");

    const redirect = Object.assign(new Error("redirect"), {
      digest: "NEXT_REDIRECT;replace;/v2;307;",
    });
    expect(recordServerError(redirect).classification).toMatchObject({
      kind: "expected",
      reason: "next_redirect",
    });
  });
});
