import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatHumanLine,
  getLogSink,
  resetLogSink,
  serializeLogLine,
  setLogSink,
  writeDefaultSink,
  type LogSink,
} from "./sink";

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

/** `process.env.NODE_ENV` is typed readonly; the writer still accepts a stub for one test block. */
function mutableEnv(): Record<string, string | undefined> {
  return process.env as unknown as Record<string, string | undefined>;
}

function captureStreams(): {
  stdout: () => string;
  stderr: () => string;
  restore: () => void;
} {
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    restore: () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}

const sampleRecord = {
  v: 1,
  ts: "2026-11-11T00:00:00.000Z",
  level: "info",
  event: "http.health.check",
  service: "flower-wms",
  env: "test",
  version: "unknown",
  requestId: "req-12345678",
  fields: { outcome: "success", status: 200 },
};

describe("sink registry", () => {
  afterEach(() => {
    resetLogSink();
  });

  it("stores an injected sink and restores the default", () => {
    const sink: LogSink = () => {};
    setLogSink(sink);
    expect(getLogSink()).toBe(sink);
    setLogSink(null);
    expect(getLogSink()).not.toBe(sink);
    resetLogSink();
    expect(getLogSink()).not.toBe(sink);
  });
});

describe("serializeLogLine", () => {
  it("serializes one record as a single JSON line", () => {
    const line = serializeLogLine(sampleRecord);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual(sampleRecord);
  });
});

describe("formatHumanLine", () => {
  it("keeps the event, level, fields and correlation ID readable", () => {
    const line = formatHumanLine(sampleRecord);
    expect(line).toContain("INFO");
    expect(line).toContain("http.health.check");
    expect(line).toContain("req-12345678");
    expect(line).toContain("outcome");
    expect(line.endsWith("\n")).toBe(true);
  });
});

describe("writeDefaultSink", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousLogFormat = process.env.LOG_FORMAT;

  beforeEach(() => {
    mutableEnv().NODE_ENV = "production";
    delete process.env.LOG_FORMAT;
  });

  afterEach(() => {
    mutableEnv().NODE_ENV = previousNodeEnv;
    if (previousLogFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = previousLogFormat;
  });

  it("writes debug/info as a JSON line to stdout", () => {
    const capture = captureStreams();
    try {
      writeDefaultSink(sampleRecord);
    } finally {
      capture.restore();
    }
    expect(capture.stderr()).toBe("");
    expect(JSON.parse(capture.stdout())).toMatchObject({
      event: "http.health.check",
      level: "info",
    });
  });

  it("writes warn/error as a JSON line to stderr", () => {
    const capture = captureStreams();
    try {
      writeDefaultSink({ ...sampleRecord, level: "error" });
    } finally {
      capture.restore();
    }
    expect(capture.stdout()).toBe("");
    expect(JSON.parse(capture.stderr())).toMatchObject({ level: "error" });
  });

  it("uses the human-readable format outside production unless LOG_FORMAT=json", () => {
    mutableEnv().NODE_ENV = "development";
    const capture = captureStreams();
    try {
      writeDefaultSink(sampleRecord);
    } finally {
      capture.restore();
    }
    expect(() => JSON.parse(capture.stdout())).toThrow();
    expect(capture.stdout()).toContain("http.health.check");

    process.env.LOG_FORMAT = "json";
    const jsonCapture = captureStreams();
    try {
      writeDefaultSink(sampleRecord);
    } finally {
      jsonCapture.restore();
    }
    expect(JSON.parse(jsonCapture.stdout())).toMatchObject({ event: "http.health.check" });
  });

  it("never throws when the stream is closed", () => {
    const failingWrite = ((() => {
      throw new Error("EPIPE");
    }) as unknown) as typeof process.stdout.write;
    process.stdout.write = failingWrite;
    try {
      expect(() => writeDefaultSink(sampleRecord)).not.toThrow();
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });
});
