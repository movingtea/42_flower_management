import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logEvent } from "./logger";
import {
  HTTP_DURATION_BUCKETS_MS,
  MAX_METRIC_SERIES,
  installMetricsLogSink,
  recordBusinessFailure,
  recordCronRound,
  recordDbProbe,
  recordErrorEvent,
  recordHttpRequest,
  recordLoginFailure,
  renderMetrics,
  resetMetricsForTests,
  sanitizeRoute,
  syncCronHeartbeatFromFile,
  uninstallMetricsLogSinkForTests,
} from "./metrics";
import { getLogSink, resetLogSink, setLogSink } from "./sink";

function lines(): string[] {
  return renderMetrics().split("\n").filter((line) => line !== "");
}

function sampleLines(name: string): string[] {
  return lines().filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `));
}

beforeEach(() => {
  uninstallMetricsLogSinkForTests();
  resetLogSink();
  resetMetricsForTests();
});

describe("renderMetrics", () => {
  it("renders an empty snapshot when nothing was recorded", () => {
    expect(renderMetrics()).toBe("");
  });

  it("renders HTTP counters and a cumulative duration histogram", () => {
    recordHttpRequest({ method: "GET", route: "/api/health", status: 200, durationMs: 30 });
    recordHttpRequest({ method: "GET", route: "/api/health", status: 200, durationMs: 600 });
    recordHttpRequest({ method: "POST", route: "/api/business/orders/:id", status: 500, durationMs: 900 });

    const text = renderMetrics();
    expect(text).toContain("# TYPE wms_http_requests_total counter");
    expect(text).toContain(
      'wms_http_requests_total{method="GET",route="/api/health",status_class="2xx"} 2',
    );
    expect(text).toContain(
      'wms_http_requests_total{method="POST",route="/api/business/orders/:id",status_class="5xx"} 1',
    );
    expect(text).toContain('wms_http_5xx_total{route="/api/business/orders/:id"} 1');
    expect(text).toContain('wms_http_request_duration_ms_bucket{route="/api/health",le="50"} 1');
    expect(text).toContain('wms_http_request_duration_ms_bucket{route="/api/health",le="1000"} 2');
    expect(text).toContain('wms_http_request_duration_ms_bucket{route="/api/health",le="+Inf"} 2');
    expect(text).toContain('wms_http_request_duration_ms_count{route="/api/health"} 2');
    expect(text).toContain('wms_http_request_duration_ms_sum{route="/api/health"} 630');
    // Every bucket boundary appears in the exposition format.
    for (const bound of HTTP_DURATION_BUCKETS_MS) {
      expect(text).toContain(`le="${bound}"`);
    }
  });

  it("does not create a 5xx series for non-5xx statuses", () => {
    recordHttpRequest({ method: "GET", route: "/api/health", status: 401, durationMs: 1 });
    expect(renderMetrics()).not.toContain("wms_http_5xx_total");
  });

  it("renders V1/V2 probe counters and duration histograms", () => {
    recordDbProbe({ db: "v1", outcome: "success", durationMs: 12 });
    recordDbProbe({ db: "v2", outcome: "failure", durationMs: 800 });
    const text = renderMetrics();
    expect(text).toContain('wms_db_probe_total{db="v1",outcome="success"} 1');
    expect(text).toContain('wms_db_probe_total{db="v2",outcome="failure"} 1');
    expect(text).toContain('wms_db_probe_duration_ms_bucket{db="v1",le="50"} 1');
    expect(text).toContain('wms_db_probe_duration_ms_count{db="v2"} 1');
  });

  it("tracks cron rounds, last success timestamp and consecutive failures", () => {
    recordCronRound({ task: "inventory-sync", outcome: "success", durationMs: 100 });
    recordCronRound({ task: "inventory-sync", outcome: "failure", durationMs: 10 });
    recordCronRound({ task: "inventory-sync", outcome: "failure", durationMs: 20 });
    recordCronRound({ task: "order-expiry", outcome: "started" });

    const text = renderMetrics();
    expect(text).toContain('wms_cron_rounds_total{task="inventory-sync",outcome="success"} 1');
    expect(text).toContain('wms_cron_rounds_total{task="inventory-sync",outcome="failure"} 2');
    expect(text).toContain('wms_cron_rounds_total{task="order-expiry",outcome="started"} 1');
    expect(text).toMatch(/wms_cron_last_success_timestamp_seconds\{task="inventory-sync"\} \d+/);
    expect(text).toContain('wms_cron_consecutive_failures{task="inventory-sync"} 2');

    // A later success resets the consecutive-failure gauge.
    recordCronRound({ task: "inventory-sync", outcome: "success" });
    expect(renderMetrics()).toContain('wms_cron_consecutive_failures{task="inventory-sync"} 0');
  });

  it("renders login failures by provider and reason", () => {
    recordLoginFailure({ provider: "legacy", reason: "unknown_user" });
    recordLoginFailure({ provider: "v2", reason: "wrong_password" });
    recordLoginFailure({ provider: "v2", reason: "wrong_password" });
    const text = renderMetrics();
    expect(text).toContain(
      'wms_login_failures_total{provider="legacy",reason="unknown_user"} 1',
    );
    expect(text).toContain('wms_login_failures_total{provider="v2",reason="wrong_password"} 2');
  });

  it("renders only known business failure signals", () => {
    recordBusinessFailure("stock_negative_blocked");
    recordBusinessFailure("not_a_signal" as never);
    const text = renderMetrics();
    expect(text).toContain('wms_business_failures_total{signal="stock_negative_blocked"} 1');
    expect(text).not.toContain("not_a_signal");
  });

  it("renders classified server-error events by expected/system kind", () => {
    recordErrorEvent({ kind: "expected", reason: "auth_rejection" });
    recordErrorEvent({ kind: "expected", reason: "validation" });
    recordErrorEvent({ kind: "system", reason: "unclassified" });
    const text = renderMetrics();
    expect(text).toContain(
      'wms_error_events_total{kind="expected",reason="auth_rejection"} 1',
    );
    expect(text).toContain(
      'wms_error_events_total{kind="expected",reason="validation"} 1',
    );
    expect(text).toContain(
      'wms_error_events_total{kind="system",reason="unclassified"} 1',
    );
  });

  it("rejects unbounded or unsafe label values", () => {
    recordHttpRequest({
      method: "TRACE" as never,
      route: "/v2/orders?token=secret",
      status: 200,
      durationMs: 5,
    });
    recordLoginFailure({ provider: "legacy", reason: 'bad"reason\nwith-newline' });
    const text = renderMetrics();
    expect(text).toContain('method="OTHER"');
    expect(text).not.toContain("token=secret");
    expect(text).toContain("route=\"/v2/orders_token_secret\"");
    const loginLine = sampleLines("wms_login_failures_total")[0];
    expect(loginLine).toBeDefined();
    expect(loginLine).not.toContain("\n");
    expect(loginLine).not.toContain('reason="bad"reason');
  });

  it("caps distinct series to protect process memory", () => {
    for (let index = 0; index < MAX_METRIC_SERIES + 25; index += 1) {
      recordHttpRequest({
        method: "GET",
        route: `/api/generated/route-${index}`,
        status: 200,
        durationMs: 1,
      });
    }
    expect(sampleLines("wms_http_requests_total").length).toBeLessThanOrEqual(MAX_METRIC_SERIES);
  });

  it("syncs cron heartbeat state from the shared file", () => {
    const dir = mkdtempSync(join(tmpdir(), "e34-heartbeat-"));
    const file = join(dir, "cron-heartbeat.json");
    try {
      writeFileSync(
        file,
        JSON.stringify({
          updatedAt: "2026-11-10T17:00:00.000Z",
          tasks: {
            "inventory-sync": {
              lastSuccessAt: "2026-11-10T16:55:00.000Z",
              consecutiveFailures: 0,
            },
            "order-expiry": {
              lastSuccessAt: "2026-11-10T16:50:00.000Z",
              consecutiveFailures: 2,
            },
          },
        }),
      );
      expect(syncCronHeartbeatFromFile(file)).toBe(true);
      const text = renderMetrics();
      expect(text).toMatch(
        /wms_cron_last_success_timestamp_seconds\{task="inventory-sync"\} \d+/,
      );
      expect(text).toContain(
        'wms_cron_consecutive_failures{task="order-expiry"} 2',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a missing or malformed heartbeat file", () => {
    expect(syncCronHeartbeatFromFile("")).toBe(false);
    expect(syncCronHeartbeatFromFile(join(tmpdir(), "does-not-exist.json"))).toBe(false);
  });
});

describe("sanitizeRoute", () => {
  it("keeps route templates and rejects arbitrary text", () => {
    expect(sanitizeRoute("/v2/orders/:id")).toBe("/v2/orders/:id");
    expect(sanitizeRoute("/api/business/[slug]")).toBe("/api/business/[slug]");
    expect(sanitizeRoute("not-a-route")).toBe("unknown");
    expect(sanitizeRoute(undefined)).toBe("unknown");
    expect(sanitizeRoute("/a b?c=d")).toBe("/a_b_c_d");
  });
});

describe("installMetricsLogSink", () => {
  it("maps http.request, login failures and negative-stock confirmation, forwarding records", () => {
    const received: Array<Record<string, unknown>> = [];
    setLogSink((record) => {
      received.push(record);
    });
    installMetricsLogSink();
    installMetricsLogSink(); // idempotent

    logEvent({
      level: "info",
      event: "http.request",
      fields: { method: "GET", route: "/v2/orders", status: 200, durationMs: 12 },
    });
    logEvent({
      level: "info",
      event: "http.request",
      fields: { method: "GET", route: "/api/health", status: 200, durationMs: 3 },
    });
    logEvent({
      level: "warn",
      event: "auth.login.attempt",
      fields: {
        outcome: "failure",
        provider: "v2",
        reason: "wrong_password",
        accountFingerprint: "0123456789abcdef",
      },
    });
    logEvent({
      level: "warn",
      event: "stocktake.confirm",
      fields: { outcome: "failure", reason: "negative_stock", stocktakeId: "st-1" },
    });
    logEvent({
      level: "debug",
      event: "error.server",
      fields: { kind: "expected", reason: "auth_rejection" },
    });
    logEvent({
      level: "error",
      event: "error.server",
      fields: { kind: "system", reason: "unclassified" },
    });

    const text = renderMetrics();
    expect(text).toContain('wms_http_requests_total{method="GET",route="/v2/orders",status_class="2xx"} 1');
    // /api/health records its own HTTP metrics in the route, so the sink must not double count it.
    expect(text).not.toContain('route="/api/health"');
    expect(text).toContain('wms_login_failures_total{provider="v2",reason="wrong_password"} 1');
    expect(text).toContain('wms_business_failures_total{signal="stock_negative_blocked"} 1');
    expect(text).toContain(
      'wms_error_events_total{kind="expected",reason="auth_rejection"} 1',
    );
    expect(text).toContain(
      'wms_error_events_total{kind="system",reason="unclassified"} 1',
    );
    // Records still reach the previous sink (stdout in production).
    expect(received).toHaveLength(6);
  });

  it("restores the previous sink for tests", () => {
    const memorySink = () => {};
    setLogSink(memorySink);
    installMetricsLogSink();
    expect(getLogSink()).not.toBe(memorySink);
    uninstallMetricsLogSinkForTests();
    expect(getLogSink()).toBe(memorySink);
  });

  it("never breaks logging when the bridge sees a malformed record", () => {
    setLogSink(() => {});
    installMetricsLogSink();
    expect(() =>
      logEvent({
        level: "info",
        event: "http.request",
        fields: { method: null as never, route: null as never, status: "x" as never },
      }),
    ).not.toThrow();
  });
});
