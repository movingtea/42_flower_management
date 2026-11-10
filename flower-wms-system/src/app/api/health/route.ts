import { logEvent } from "@/lib/observability/logger";
import {
  recordDbProbe,
  recordHttpRequest,
} from "@/lib/observability/metrics";
import {
  ensureRequestId,
  REQUEST_ID_HEADER,
} from "@/lib/observability/request-id";

export const dynamic = "force-dynamic";

type ProbeOutcome = { ok: boolean; durationMs: number };

/** Probe one database with a bounded SELECT 1 while keeping its duration for logs. */
async function probeDatabase(run: () => Promise<unknown>): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  try {
    await run();
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch {
    return { ok: false, durationMs: Date.now() - startedAt };
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  // The proxy forwards a validated ID; a direct call (tests, tooling) gets a fresh one.
  const requestId = ensureRequestId(request?.headers?.get(REQUEST_ID_HEADER));

  let v1: ProbeOutcome | null = null;
  let v2: ProbeOutcome | null = null;

  try {
    // Lazy import keeps a missing V1/V2 client from failing module evaluation.
    const [{ prisma }, { v2db }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/v2/db"),
    ]);
    const [v1Result, v2Result] = await Promise.all([
      probeDatabase(() => prisma.$queryRaw`SELECT 1`),
      probeDatabase(() => v2db.$queryRaw`SELECT 1`),
    ]);
    v1 = v1Result;
    v2 = v2Result;
  } catch {
    // A failed dynamic import counts as both databases being unavailable.
  }

  const ok = v1?.ok === true && v2?.ok === true;
  const status = ok ? 200 : 503;
  const durationMs = Date.now() - startedAt;
  const failedDb = ok
    ? undefined
    : v1 && !v1.ok && v2 && v2.ok
      ? "v1"
      : v2 && !v2.ok && v1 && v1.ok
        ? "v2"
        : "both";

  // Metrics are recorded here (the log sink skips /api/health http.request) so each
  // readiness probe contributes exactly one HTTP observation and one probe per database.
  recordDbProbe({
    db: "v1",
    outcome: v1?.ok ? "success" : "failure",
    durationMs: v1?.durationMs ?? 0,
  });
  recordDbProbe({
    db: "v2",
    outcome: v2?.ok ? "success" : "failure",
    durationMs: v2?.durationMs ?? 0,
  });
  recordHttpRequest({
    method: request?.method ?? "GET",
    route: "/api/health",
    status,
    durationMs,
  });

  // The response contract stays exactly {"status":"ok"} / {"status":"unavailable"}.
  logEvent({
    level: ok ? "info" : "warn",
    event: "http.health.check",
    requestId,
    fields: {
      outcome: ok ? "success" : "failure",
      status,
      v1DurationMs: v1?.durationMs ?? null,
      v2DurationMs: v2?.durationMs ?? null,
      ...(failedDb === undefined ? {} : { failedDb }),
    },
  });
  logEvent({
    level: "info",
    event: "http.request",
    requestId,
    fields: {
      method: request?.method ?? "GET",
      route: "/api/health",
      status,
      durationMs,
    },
  });

  const headers = { [REQUEST_ID_HEADER]: requestId };
  if (ok) return Response.json({ status: "ok" }, { headers });
  return Response.json({ status: "unavailable" }, { status: 503, headers });
}
