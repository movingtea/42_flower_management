/**
 * Next.js instrumentation (Sprint E3.2 request correlation + E3.3 error capture).
 *
 * `register` runs once per server instance, before the server accepts requests.
 * It emits the single `service.started` event and initializes the
 * AsyncLocalStorage-backed log context module so the first request does not pay
 * that initialization.
 *
 * `onRequestError` (appended by E3.3) receives every server error Next.js
 * captures (Route Handler, Server Action, render and proxy). It delegates to
 * `recordServerError`, which classifies the error: expected authentication /
 * control-flow / business outcomes stay at debug level (countable, never
 * alert-level), while system errors become one sanitized `error.server` event
 * delivered through the local adapter. Delivery failures are logged as
 * `error.delivery.failed` and are swallowed here, so a broken tracing pipeline
 * can never change the response or crash the server.
 */
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ getLogContext }, { logEvent }] = await Promise.all([
    import("@/lib/observability/context"),
    import("@/lib/observability/logger"),
    // Importing the metrics module installs the log-event -> metric bridge at
    // startup, so expected/system error counts (and login/business counters) do
    // not miss events that happen before the first metrics/health request.
    import("@/lib/observability/metrics"),
  ]);

  // Touch the context store so the AsyncLocalStorage instance exists at startup.
  getLogContext();

  logEvent({
    level: "info",
    event: "service.started",
    fields: {
      // Read through globalThis so the Edge compilation of instrumentation does not
      // see a direct `process.pid` Node API reference (this branch only runs on Node).
      pid: (globalThis as { process?: { pid?: number } }).process?.pid ?? 0,
      nodeEnv: process.env.NODE_ENV ?? "unknown",
    },
  });
}

/**
 * Server-error hook. Errors are only handled on the Node.js runtime; the Edge
 * runtime keeps the default Next.js behaviour because the delivery adapter is
 * filesystem/stderr based.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recordServerError } = await import(
      "@/lib/observability/error-events"
    );
    // `recordServerError` never throws; this await only makes the async import
    // ordering explicit (Next.js awaits async `onRequestError` handlers).
    recordServerError(error, request, context);
  } catch (handlerError) {
    // Loading the observability module itself failed. Never surface it to the
    // request path; log one best-effort delivery failure if logging is up.
    try {
      const { logEvent } = await import("@/lib/observability/logger");
      logEvent({
        level: "error",
        event: "error.delivery.failed",
        fields: {
          adapter: "instrumentation",
          reason:
            handlerError instanceof Error && handlerError.name !== ""
              ? handlerError.name
              : "handler_error",
        },
      });
    } catch {
      // Nothing more can be done: the application must keep running.
    }
  }
};
