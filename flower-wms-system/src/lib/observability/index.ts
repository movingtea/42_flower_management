/**
 * Sprint E3.1 observability barrel.
 *
 * Later work packages (E3.2+) import the concrete module path directly instead
 * of extending this barrel, so this file stays a stable E3.1 surface.
 */
export {
  CIRCULAR,
  DEPTH_LIMIT,
  REDACTED,
  MAX_REDACT_ARRAY_ITEMS,
  MAX_REDACT_DEPTH,
  MAX_REDACT_KEYS,
  fingerprintAccount,
  isSensitiveKey,
  redactSensitiveSubstrings,
  redactText,
  redactValue,
} from "./redact";
export {
  formatHumanLine,
  getLogSink,
  resetLogSink,
  serializeLogLine,
  setLogSink,
  writeDefaultSink,
  type LogSink,
} from "./sink";
export {
  buildLogRecord,
  createLogger,
  logEvent,
  type LogEventInput,
  type LogLevel,
  type LogRecord,
  type SerializedError,
} from "./logger";
export { getLogContext, runWithLogContext, type LogContext } from "./context";
