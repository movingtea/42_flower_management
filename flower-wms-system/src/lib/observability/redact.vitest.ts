import { describe, expect, it } from "vitest";
import {
  CIRCULAR,
  DEPTH_LIMIT,
  MAX_REDACT_ARRAY_ITEMS,
  MAX_REDACT_KEYS,
  REDACTED,
  fingerprintAccount,
  isSensitiveKey,
  redactSensitiveSubstrings,
  redactText,
  redactValue,
} from "./redact";

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("isSensitiveKey", () => {
  it("matches credential keys case-insensitively and ignoring _/-", () => {
    for (const key of [
      "password",
      "PASSWORD",
      "db_password",
      "passwd",
      "pwd",
      "pass",
      "secret",
      "AUTH_SECRET",
      "token",
      "access-token",
      "Authorization",
      "cookie",
      "set-cookie",
      "setCookie",
      "apiKey",
      "api_key",
      "apiSecret",
      "dsn",
      "connectionString",
      "connection_string",
      "DATABASE_URL",
      "privateKey",
      "credential",
      "credentials",
      "authSecret",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("leaves ordinary business fields alone", () => {
    for (const key of ["outcome", "status", "stocktakeId", "storeId", "durationMs", "route"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("redactText", () => {
  it("replaces a whole string that contains a credential or connection URL", () => {
    for (const value of [
      "postgres://user:pw@127.0.0.1:5432/db",
      "postgresql://user:pw@host/db",
      "mysql://user:pw@host/db",
      "redis://cache:6379",
      "log line with postgres://user:pw@host/db inside",
      "Bearer abc.def.ghi",
      "Basic dXNlcjpwYXNz",
    ]) {
      expect(redactText(value), value).toBe(REDACTED);
    }
  });

  it("keeps ordinary text", () => {
    expect(redactText("盘点确认成功")).toBe("盘点确认成功");
    expect(redactText("/api/health")).toBe("/api/health");
  });
});

describe("redactSensitiveSubstrings", () => {
  it("replaces embedded credentials but keeps the surrounding stack", () => {
    const stack = [
      "Error: boom",
      "    at connect (postgres://user:pw@127.0.0.1:5432/wms)",
      "    at main (/app/src/lib/db.ts:1:1)",
    ].join("\n");
    const redacted = redactSensitiveSubstrings(stack);
    expect(redacted).toContain("Error: boom");
    expect(redacted).toContain("at main");
    expect(redacted).not.toContain("user:pw");
    expect(redacted).toContain(REDACTED);
  });
});

describe("database connection details", () => {
  it("replaces Prisma/node-postgres host:port messages as a whole", () => {
    for (const value of [
      "Can't reach database server at localhost:5432",
      "Can't reach database server at 10.1.2.3:5432",
      "Can't reach database server at 127.0.0.1:1",
      "connect ECONNREFUSED 127.0.0.1:5432",
      'connection to server at "db.internal", port 5432 failed: Connection refused',
    ]) {
      expect(redactText(value), value).toBe(REDACTED);
    }
  });

  it("scrubs host:port and Prisma wording from stacks while keeping source frames", () => {
    const stack = [
      "Error: Can't reach database server at localhost:5432",
      '    at connect (127.0.0.1:5432)',
      "    at handler (/app/src/services/inventory-sync.ts:92:28)",
    ].join("\n");
    const redacted = redactSensitiveSubstrings(stack);
    expect(redacted).not.toContain("localhost:5432");
    expect(redacted).not.toContain("127.0.0.1:5432");
    expect(redacted).toContain("/app/src/services/inventory-sync.ts:92:28");
  });

  it("does not confuse ordinary source line references with host:port details", () => {
    for (const value of [
      "    at RequestHandler.ts:237:13",
      "src/lib/db.ts:12:3",
      "GET /api/health 200 in 12ms",
    ]) {
      expect(redactText(value), value).toBe(value);
      expect(redactSensitiveSubstrings(value), value).toBe(value);
    }
  });
});

describe("redactValue", () => {
  it("redacts sensitive keys recursively through objects and arrays", () => {
    const value = {
      password: "super-secret",
      nested: {
        cookie: "session=abc",
        list: [{ authorization: "Bearer token" }, { safe: "ok" }],
      },
    };
    const redacted = asRecord(redactValue(value));
    expect(redacted.password).toBe(REDACTED);
    const nested = asRecord(redacted.nested);
    expect(nested.cookie).toBe(REDACTED);
    const list = nested.list as Array<Record<string, unknown>>;
    expect(list[0].authorization).toBe(REDACTED);
    expect(list[1].safe).toBe("ok");
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.stringify(redacted)).not.toContain("session=abc");
    expect(JSON.stringify(redacted)).not.toContain("Bearer token");
  });

  it("replaces connection strings held in ordinary keys", () => {
    const redacted = asRecord(
      redactValue({ note: "postgres://user:pw@127.0.0.1:5432/wms", outcome: "failure" }),
    );
    expect(redacted.note).toBe(REDACTED);
    expect(redacted.outcome).toBe("failure");
  });

  it("turns a circular reference into a marker instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;
    const redacted = asRecord(redactValue(circular));
    expect(redacted.name).toBe("root");
    expect(redacted.self).toBe(CIRCULAR);
    expect(() => JSON.stringify(redacted)).not.toThrow();
  });

  it("caps depth, object keys and array items", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 10; index += 1) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).toContain(DEPTH_LIMIT);

    const wide: Record<string, number> = {};
    for (let index = 0; index < MAX_REDACT_KEYS + 20; index += 1) wide[`key${index}`] = index;
    expect(Object.keys(asRecord(redactValue(wide)))).toHaveLength(MAX_REDACT_KEYS);

    const longArray = Array.from({ length: MAX_REDACT_ARRAY_ITEMS + 10 }, (_, index) => index);
    expect((redactValue(longArray) as unknown[]).length).toBe(MAX_REDACT_ARRAY_ITEMS);
  });

  it("safely stringifies values JSON cannot represent", () => {
    const redacted = asRecord(
      redactValue({
        big: BigInt("9007199254740993"),
        fn: () => "nope",
        sym: Symbol("marker"),
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        date: new Date("2026-11-11T00:00:00.000Z"),
        error: new Error("boom"),
      }),
    );
    expect(redacted.big).toBe("9007199254740993");
    expect(redacted.fn).toBe("[function]");
    expect(redacted.sym).toBe("[symbol]");
    expect(redacted.nan).toBe("NaN");
    expect(redacted.infinite).toBe("Infinity");
    expect(redacted.date).toBe("2026-11-11T00:00:00.000Z");
    expect(redacted.error).toBe("[error:Error]");
    expect(() => JSON.stringify(redacted)).not.toThrow();
  });
});

describe("fingerprintAccount", () => {
  function withSecrets(values: { auth?: string; nextauth?: string }, run: () => void) {
    const previousAuth = process.env.AUTH_SECRET;
    const previousNextAuth = process.env.NEXTAUTH_SECRET;
    try {
      if (values.auth === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = values.auth;
      if (values.nextauth === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = values.nextauth;
      run();
    } finally {
      if (previousAuth === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousAuth;
      if (previousNextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previousNextAuth;
    }
  }

  it("is a stable 16-char hex HMAC that never contains the plaintext username", () => {
    withSecrets({ auth: "unit-test-secret", nextauth: "unit-test-secret" }, () => {
      const fingerprint = fingerprintAccount("Admin.User");
      expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(fingerprint).toBe(fingerprintAccount("  admin.user  "));
      expect(fingerprint).not.toBe(fingerprintAccount("other.user"));
      expect(fingerprint).not.toContain("admin");
    });
  });

  it("changes when the HMAC secret changes", () => {
    withSecrets({ auth: "secret-a", nextauth: "" }, () => {
      const first = fingerprintAccount("admin");
      process.env.AUTH_SECRET = "secret-b";
      expect(fingerprintAccount("admin")).not.toBe(first);
    });
  });

  it("falls back to NEXTAUTH_SECRET when AUTH_SECRET is absent", () => {
    withSecrets({ nextauth: "fallback-secret" }, () => {
      expect(fingerprintAccount("admin")).toBe(
        (() => {
          process.env.AUTH_SECRET = "fallback-secret";
          const migrated = fingerprintAccount("admin");
          delete process.env.AUTH_SECRET;
          return migrated;
        })(),
      );
    });
  });

  it("uses the documented development fallback when no secret is configured", () => {
    withSecrets({}, () => {
      expect(fingerprintAccount("admin")).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});
