/**
 * Log sinks for the structured log schema (Sprint E3.1).
 *
 * Production writes one JSON object per line: `debug`/`info` to stdout and
 * `warn`/`error` to stderr, which is what container log collection expects.
 * Local development may use a human-readable line unless `LOG_FORMAT=json`.
 * Tests inject an in-memory sink through `setLogSink`.
 *
 * Every write is best effort. A closed or detached stream (EPIPE, a sink that
 * throws) must never change a business result.
 */

export type LogSink = (record: Record<string, unknown>) => void;

/** Default sink: JSON line to stdout/stderr, human readable locally. */
const defaultSink: LogSink = (record) => {
  writeDefaultSink(record);
};

let activeSink: LogSink = defaultSink;

/** Replace the process-wide sink. Pass `null` (or use `resetLogSink`) to restore the default. */
export function setLogSink(sink: LogSink | null): void {
  activeSink = sink ?? defaultSink;
}

/** Restore the default stdout/stderr sink. */
export function resetLogSink(): void {
  activeSink = defaultSink;
}

/** Current sink, used by the logger. */
export function getLogSink(): LogSink {
  return activeSink;
}

function prefersHumanReadable(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LOG_FORMAT !== "json";
}

/** Serialize one fixed-schema record as a single JSON line. */
export function serializeLogLine(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`;
}

/** Render a compact, still-parseable line for local development. */
export function formatHumanLine(record: Record<string, unknown>): string {
  const ts = typeof record.ts === "string" ? record.ts : "";
  const level = typeof record.level === "string" ? record.level.toUpperCase().padEnd(5) : "INFO";
  const event = typeof record.event === "string" ? record.event : "log.event";
  const parts = [ts, level, event];

  const fields = record.fields;
  if (fields && typeof fields === "object" && Object.keys(fields).length > 0) {
    parts.push(JSON.stringify(fields));
  }

  const requestId = typeof record.requestId === "string" ? record.requestId : null;
  if (requestId) parts.push(`requestId=${requestId}`);
  const runId = typeof record.runId === "string" ? record.runId : null;
  if (runId) parts.push(`runId=${runId}`);

  const err = record.err;
  if (err && typeof err === "object") {
    const candidate = err as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === "string" ? candidate.name : "Error";
    const message = typeof candidate.message === "string" ? candidate.message : "";
    parts.push(`err=${name}: ${message}`);
  }

  return `${parts.join(" ")}\n`;
}

/** Write a record to stdout/stderr; never throws. */
export function writeDefaultSink(record: Record<string, unknown>): void {
  const isErrorLevel = record.level === "warn" || record.level === "error";
  const stream = isErrorLevel ? process.stderr : process.stdout;
  try {
    stream.write(prefersHumanReadable() ? formatHumanLine(record) : serializeLogLine(record));
  } catch {
    // Logging is best effort: EPIPE or a closed stream must not abort the caller.
  }
}
