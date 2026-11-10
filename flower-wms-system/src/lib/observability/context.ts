/**
 * Async request/run log context (Sprint E3.1).
 *
 * `AsyncLocalStorage` lets one HTTP request or cron task share its request ID /
 * run ID with every log event emitted in that async call tree without threading
 * the value through service signatures. The proxy/instrumentation layer fills
 * this in (E3.2); background tasks use `runWithLogContext` directly.
 *
 * Only the Node.js runtime has `AsyncLocalStorage`; when it is unavailable the
 * helpers degrade to a no-context no-op instead of failing a request.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type LogContext = {
  requestId?: string;
  runId?: string;
};

let storage: AsyncLocalStorage<LogContext> | null = null;
try {
  storage = new AsyncLocalStorage<LogContext>();
} catch {
  storage = null;
}

/** Run `fn` with the given correlation IDs; the IDs are visible to nested async calls. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  if (!storage) return fn();
  return storage.run({ ...context }, fn);
}

/** Current correlation IDs, or `{}` outside a context. */
export function getLogContext(): LogContext {
  if (!storage) return {};
  try {
    return storage.getStore() ?? {};
  } catch {
    return {};
  }
}
