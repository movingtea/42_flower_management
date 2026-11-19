import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithLogContext } from "./context";
import {
  buildLogRecord,
  createLogger,
  logEvent,
  type LogRecord,
} from "./logger";
import { CIRCULAR, DEPTH_LIMIT, REDACTED } from "./redact";
import { resetLogSink, setLogSink } from "./sink";

let records: LogRecord[] = [];

function recordsAsUnknown(): Array<Record<string, unknown>> {
  return records as unknown as Array<Record<string, unknown>>;
}

function onlyRecord(): Record<string, unknown> {
  expect(records).toHaveLength(1);
  return recordsAsUnknown()[0];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

beforeEach(() => {
  records = [];
  setLogSink((record) => {
    records.push(record as unknown as LogRecord);
  });
});

afterEach(() => {
  resetLogSink();
});

describe("logEvent schema", () => {
  it("emits the fixed v1 record with UTC timestamp, service and metadata", () => {
    logEvent({
      level: "info",
      event: "http.health.check",
      fields: { outcome: "success", status: 200 },
    });

    const record = onlyRecord();
    expect(record.v).toBe(1);
    expect(typeof record.ts).toBe("string");
    expect(new Date(String(record.ts)).toISOString()).toBe(record.ts);
    expect(record.level).toBe("info");
    expect(record.event).toBe("http.health.check");
    expect(record.service).toBe("flower-wms");
    expect(typeof record.env).toBe("string");
    expect(typeof record.version).toBe("string");
    expect(record.fields).toEqual({ outcome: "success", status: 200 });
    expect(record.requestId).toBeUndefined();
    expect(record.runId).toBeUndefined();
    expect(() => JSON.parse(JSON.stringify(record))).not.toThrow();
  });

  it("reads env and version from APP_ENV/APP_VERSION with safe defaults", () => {
    const previousEnv = process.env.APP_ENV;
    const previousVersion = process.env.APP_VERSION;
    try {
      process.env.APP_ENV = "staging";
      process.env.APP_VERSION = "2026.11.11-abc1234";
      logEvent({ level: "info", event: "service.started", fields: { pid: 1 } });
      const record = onlyRecord();
      expect(record.env).toBe("staging");
      expect(record.version).toBe("2026.11.11-abc1234");
    } finally {
      if (previousEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previousEnv;
      if (previousVersion === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = previousVersion;
    }
  });

  it("normalizes an unknown level/event instead of failing", () => {
    logEvent({
      level: "verbose" as unknown as LogRecord["level"],
      event: "   ",
    });
    const record = onlyRecord();
    expect(record.level).toBe("info");
    expect(record.event).toBe("log.event");
    expect(record.fields).toEqual({});
  });
});

describe("correlation context", () => {
  it("fills requestId and runId from the async log context", () => {
    runWithLogContext({ requestId: "req-12345678", runId: "run-1" }, () => {
      logEvent({ level: "info", event: "cron.task.round", fields: { task: "order-expiry" } });
    });
    const record = onlyRecord();
    expect(record.requestId).toBe("req-12345678");
    expect(record.runId).toBe("run-1");
  });

  it("prefers an explicit ID over the context", () => {
    runWithLogContext({ requestId: "req-context" }, () => {
      logEvent({ level: "info", event: "http.request", requestId: "req-explicit" });
    });
    expect(onlyRecord().requestId).toBe("req-explicit");
  });

  it("createLogger binds an immutable run ID but still reads the request context", () => {
    runWithLogContext({ requestId: "req-bound-1" }, () => {
      const logger = createLogger({ runId: "run-bound" });
      logger.logEvent({ level: "info", event: "cron.task.round", fields: { outcome: "started" } });
    });
    const record = onlyRecord();
    expect(record.requestId).toBe("req-bound-1");
    expect(record.runId).toBe("run-bound");
  });
});

describe("redaction through the logger", () => {
  it("never serializes sensitive field values", () => {
    logEvent({
      level: "info",
      event: "auth.login.attempt",
      fields: {
        provider: "legacy",
        password: "Plaintext-Password-123",
        nested: { cookie: "next-auth.session-token=abc", token: "tok_123" },
        list: [{ authorization: "Bearer abcdef" }],
      },
    });
    const serialized = JSON.stringify(onlyRecord());
    expect(serialized).not.toContain("Plaintext-Password-123");
    expect(serialized).not.toContain("next-auth.session-token");
    expect(serialized).not.toContain("tok_123");
    expect(serialized).not.toContain("Bearer abcdef");
    expect(serialized).toContain(REDACTED);
  });

  it("serializes circular and unserializable field values without throwing", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    expect(() =>
      logEvent({
        level: "info",
        event: "http.request",
        fields: {
          circular,
          big: BigInt(42),
          handler: () => undefined,
          deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
        },
      }),
    ).not.toThrow();

    const record = onlyRecord();
    const fields = asRecord(record.fields);
    expect(asRecord(fields.circular).name).toBe("root");
    expect(asRecord(fields.circular).self).toBe(CIRCULAR);
    expect(fields.big).toBe("42");
    expect(fields.handler).toBe("[function]");
    expect(JSON.stringify(record)).toContain(DEPTH_LIMIT);
  });
});

describe("error serialization", () => {
  it("keeps stable Error fields and a stack for error level only", () => {
    const failure = Object.assign(new Error("backend exploded"), {
      code: "E_BACKEND",
      digest: "digest-42",
    });

    logEvent({ level: "error", event: "error.server", error: failure });
    const errorLevel = asRecord(onlyRecord().err);
    expect(errorLevel.name).toBe("Error");
    expect(errorLevel.message).toBe("backend exploded");
    expect(errorLevel.code).toBe("E_BACKEND");
    expect(errorLevel.digest).toBe("digest-42");
    expect(typeof errorLevel.stack).toBe("string");

    logEvent({ level: "warn", event: "auth.login.attempt", error: failure });
    const warnLevel = asRecord(records[1].err);
    expect(warnLevel.name).toBe("Error");
    expect(warnLevel.stack).toBeUndefined();
  });

  it("omits the stack when LOG_STACKS=false", () => {
    const previous = process.env.LOG_STACKS;
    try {
      process.env.LOG_STACKS = "false";
      logEvent({ level: "error", event: "error.server", error: new Error("boom") });
      expect(asRecord(onlyRecord().err).stack).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.LOG_STACKS;
      else process.env.LOG_STACKS = previous;
    }
  });

  it("redacts credentials inside the error message and stack", () => {
    const failure = new Error("connect failed postgres://user:pw@127.0.0.1:5432/wms");
    logEvent({ level: "error", event: "error.server", error: failure });
    const serialized = JSON.stringify(onlyRecord());
    expect(serialized).not.toContain("user:pw");
    expect(asRecord(onlyRecord().err).message).toBe(REDACTED);
  });

  it("never serializes database host:port connection details", () => {
    const failure = Object.assign(
      new Error("Can't reach database server at localhost:5432"),
      { name: "PrismaClientKnownRequestError", code: "P1001" },
    );
    logEvent({ level: "error", event: "error.server", error: failure });
    const serialized = JSON.stringify(onlyRecord());
    expect(serialized).not.toContain("localhost:5432");
    expect(serialized).not.toContain(":5432");
    expect(asRecord(onlyRecord().err).message).toBe(REDACTED);
    expect(asRecord(onlyRecord().err).code).toBe("P1001");
    expect(serialized).toContain("PrismaClientKnownRequestError");
  });

  it("accepts a thrown non-Error value", () => {
    logEvent({ level: "warn", event: "auth.login.attempt", error: "plain string failure" });
    const serializedError = asRecord(onlyRecord().err);
    expect(serializedError.name).toBe("ThrownValue");
    expect(serializedError.message).toBe("plain string failure");
  });
});

describe("failure isolation", () => {
  it("swallows sink failures without changing the caller result", () => {
    setLogSink(() => {
      throw new Error("sink is down");
    });

    const businessResult = (() => {
      logEvent({ level: "info", event: "stocktake.confirm", fields: { outcome: "success" } });
      return "committed";
    })();

    expect(businessResult).toBe("committed");
    expect(() => logEvent({ level: "error", event: "error.server", error: new Error("x") })).not.toThrow();
  });

  it("buildLogRecord never throws even for a circular error object", () => {
    const failure: Record<string, unknown> = { name: "WeirdError" };
    failure.self = failure;
    expect(() => buildLogRecord({ level: "error", event: "error.server", error: failure })).not.toThrow();
  });
});
