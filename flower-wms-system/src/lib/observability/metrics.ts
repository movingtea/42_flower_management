/**
 * Process-local, low-cardinality metrics for Sprint E3.4.
 *
 * The module renders Prometheus text exposition and is deliberately dependency
 * free. Only fixed label enums are accepted: route templates, HTTP methods,
 * status classes, database ids, cron task names and stable failure signals. IDs
 * from business records, request IDs, query strings and arbitrary error text are
 * never accepted as labels.
 *
 * A log sink wrapper maps existing structured events (`http.request`,
 * `auth.login.attempt` failures, `stocktake.confirm` negative-stock failures,
 * `error.server` expected/system events) to counters. The wrapper is installed
 * once, idempotently, when this module is first imported by the web or cron
 * process (except under the test runtime).
 *
 * The web process cannot see the cron process' in-memory gauges. When
 * `CRON_HEARTBEAT_FILE` is set (staging compose mounts the same volume), the
 * protected metrics route calls `syncCronHeartbeatFromFile()` so the web
 * snapshot reports the last successful cron round and consecutive failures.
 * Multi-instance aggregation is out of scope: each process exposes its own
 * snapshot (documented in deploy/observability/metrics-catalog.md).
 */
import { readFileSync } from "node:fs";
import { getLogSink, setLogSink, type LogSink } from "./sink";

export const HTTP_DURATION_BUCKETS_MS = [50, 100, 200, 500, 1000, 2000, 5000] as const;
export const DB_DURATION_BUCKETS_MS = HTTP_DURATION_BUCKETS_MS;
export const MAX_METRIC_SERIES = 5000;

const CRON_TASKS = ["inventory-sync", "order-expiry"] as const;
const LOGIN_PROVIDERS = ["legacy", "v2"] as const;
const ERROR_EVENT_KINDS = ["expected", "system"] as const;
const BUSINESS_SIGNALS = [
  "stock_negative_blocked",
  "purchase_receive_failed",
  "order_confirm_failed",
  "delivery_failed",
  "cost_recalc_failed",
] as const;

export type CronTask = (typeof CRON_TASKS)[number];
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];
export type ErrorEventKind = (typeof ERROR_EVENT_KINDS)[number];
export type BusinessSignal = (typeof BUSINESS_SIGNALS)[number];
export type DbProbeDb = "v1" | "v2";
export type DbProbeOutcome = "success" | "failure";
export type CronOutcome = "started" | "success" | "failure";

type Histogram = {
  buckets: number[];
  count: number;
  sum: number;
};

type MetricsState = {
  series: Set<string>;
  httpRequests: Map<string, number>;
  http5xx: Map<string, number>;
  httpDuration: Map<string, Histogram>;
  dbProbe: Map<string, number>;
  dbDuration: Map<string, Histogram>;
  cronLastSuccess: Map<string, number>;
  cronConsecutiveFailures: Map<string, number>;
  cronRounds: Map<string, number>;
  loginFailures: Map<string, number>;
  businessFailures: Map<string, number>;
  errorEvents: Map<string, number>;
};

function createState(): MetricsState {
  return {
    series: new Set<string>(),
    httpRequests: new Map<string, number>(),
    http5xx: new Map<string, number>(),
    httpDuration: new Map<string, Histogram>(),
    dbProbe: new Map<string, number>(),
    dbDuration: new Map<string, Histogram>(),
    cronLastSuccess: new Map<string, number>(),
    cronConsecutiveFailures: new Map<string, number>(),
    cronRounds: new Map<string, number>(),
    loginFailures: new Map<string, number>(),
    businessFailures: new Map<string, number>(),
    errorEvents: new Map<string, number>(),
  };
}

let state = createState();

function joinKey(values: readonly string[]): string {
  return values.join("\u0000");
}

/** Reserve a series slot; false when the hard cap is reached (new series dropped). */
function reserveSeries(seriesKey: string): boolean {
  if (state.series.has(seriesKey)) return true;
  if (state.series.size >= MAX_METRIC_SERIES) return false;
  state.series.add(seriesKey);
  return true;
}

function increment(map: Map<string, number>, seriesKey: string, amount = 1): void {
  if (!reserveSeries(seriesKey)) return;
  map.set(seriesKey, (map.get(seriesKey) ?? 0) + amount);
}

function observeHistogram(
  map: Map<string, Histogram>,
  seriesKey: string,
  buckets: readonly number[],
  value: number,
): void {
  if (!reserveSeries(seriesKey)) return;
  let histogram = map.get(seriesKey);
  if (!histogram) {
    histogram = { buckets: new Array<number>(buckets.length).fill(0), count: 0, sum: 0 };
    map.set(seriesKey, histogram);
  }
  const bucketIndex = buckets.findIndex((bound) => value <= bound);
  const index = bucketIndex === -1 ? buckets.length : bucketIndex;
  histogram.buckets[index] += 1;
  histogram.count += 1;
  histogram.sum += value;
}

/** Route templates only: no query strings, IDs or arbitrary text. */
export function sanitizeRoute(route: unknown): string {
  if (typeof route !== "string" || !route.startsWith("/")) return "unknown";
  const cleaned = route.replace(/[^A-Za-z0-9._/:[\]-]/g, "_").slice(0, 120);
  return cleaned === "" ? "/" : cleaned;
}

function sanitizeMethod(method: unknown): string {
  const value = typeof method === "string" ? method.toUpperCase() : "";
  return ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(value)
    ? value
    : "OTHER";
}

function statusClass(status: number): string {
  if (!Number.isFinite(status) || status < 100 || status > 599) return "unknown";
  return `${Math.floor(status / 100)}xx`;
}

function sanitizeDuration(durationMs: unknown): number {
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : 0;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

/** Record one HTTP request observation (method/route/status are already low cardinality). */
export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const method = sanitizeMethod(input.method);
  const route = sanitizeRoute(input.route);
  const status = Number.isFinite(input.status) ? input.status : 0;
  const durationMs = sanitizeDuration(input.durationMs);

  increment(state.httpRequests, joinKey([method, route, statusClass(status)]));
  if (status >= 500 && status <= 599) {
    increment(state.http5xx, joinKey([route]));
  }
  observeHistogram(
    state.httpDuration,
    joinKey([route]),
    HTTP_DURATION_BUCKETS_MS,
    durationMs,
  );
}

/** Record one V1/V2 database probe result. */
export function recordDbProbe(input: {
  db: DbProbeDb;
  outcome: DbProbeOutcome;
  durationMs: number;
}): void {
  const db = oneOf(input.db, ["v1", "v2"] as const, "v1");
  const outcome = oneOf(input.outcome, ["success", "failure"] as const, "failure");
  increment(state.dbProbe, joinKey([db, outcome]));
  observeHistogram(
    state.dbDuration,
    joinKey([db]),
    DB_DURATION_BUCKETS_MS,
    sanitizeDuration(input.durationMs),
  );
}

/** Record one cron task round; success resets the consecutive-failure gauge. */
export function recordCronRound(input: {
  task: CronTask;
  outcome: CronOutcome;
  durationMs?: number;
  counts?: { affected?: number; scanned?: number };
}): void {
  const task = oneOf(input.task, CRON_TASKS, "inventory-sync");
  const outcome = oneOf(input.outcome, ["started", "success", "failure"] as const, "failure");
  increment(state.cronRounds, joinKey([task, outcome]));
  if (outcome === "success") {
    state.cronLastSuccess.set(task, Math.floor(Date.now() / 1000));
    state.cronConsecutiveFailures.set(task, 0);
  } else if (outcome === "failure") {
    state.cronConsecutiveFailures.set(task, (state.cronConsecutiveFailures.get(task) ?? 0) + 1);
  }
}

/** Record one authentication failure for the stable provider/reason labels. */
export function recordLoginFailure(input: { provider: LoginProvider; reason: string }): void {
  const provider = oneOf(input.provider, LOGIN_PROVIDERS, "legacy");
  const reason =
    typeof input.reason === "string" && input.reason.trim() !== ""
      ? input.reason.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64)
      : "unknown";
  increment(state.loginFailures, joinKey([provider, reason]));
}

/** Record one stable business failure signal. Unknown signals are ignored. */
export function recordBusinessFailure(signal: BusinessSignal): void {
  if (!(BUSINESS_SIGNALS as readonly string[]).includes(signal)) return;
  increment(state.businessFailures, signal);
}

/**
 * Count one classified server-error event (E3.3 contract). `expected` covers
 * auth rejections, control flow, validation and controlled business conflicts;
 * `system` is the alert-level bucket. `reason` is the classifier's fixed enum.
 */
export function recordErrorEvent(input: {
  kind: ErrorEventKind;
  reason: string;
}): void {
  const kind = oneOf(input.kind, ERROR_EVENT_KINDS, "system");
  const reason =
    typeof input.reason === "string" && input.reason.trim() !== ""
      ? input.reason.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64)
      : "unknown";
  increment(state.errorEvents, joinKey([kind, reason]));
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
    .map(([name, value]) => `${name}="${escapeLabelValue(value)}"`)
    .join(",");
  return entries === "" ? "" : `{${entries}}`;
}

function sortedEntries(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function splitKey(key: string): string[] {
  return key.split("\u0000");
}

function renderCounter(
  lines: string[],
  name: string,
  help: string,
  map: Map<string, number>,
  labelNames: readonly string[],
): void {
  if (map.size === 0) return;
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} counter`);
  for (const [key, value] of sortedEntries(map)) {
    const labels: Record<string, string> = {};
    const parts = splitKey(key);
    labelNames.forEach((labelName, index) => {
      labels[labelName] = parts[index] ?? "";
    });
    lines.push(`${name}${renderLabels(labels)} ${value}`);
  }
}

function renderHistogram(
  lines: string[],
  baseName: string,
  help: string,
  map: Map<string, Histogram>,
  labelName: string,
  buckets: readonly number[],
): void {
  if (map.size === 0) return;
  lines.push(`# HELP ${baseName} ${help}`);
  lines.push(`# TYPE ${baseName} histogram`);
  for (const [key, histogram] of [...map.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const labelValue = splitKey(key)[0] ?? "";
    let cumulative = 0;
    buckets.forEach((bound, index) => {
      cumulative += histogram.buckets[index] ?? 0;
      lines.push(
        `${baseName}_bucket${renderLabels({ [labelName]: labelValue, le: String(bound) })} ${cumulative}`,
      );
    });
    cumulative += histogram.buckets[buckets.length] ?? 0;
    lines.push(
      `${baseName}_bucket${renderLabels({ [labelName]: labelValue, le: "+Inf" })} ${cumulative}`,
    );
    lines.push(
      `${baseName}_count${renderLabels({ [labelName]: labelValue })} ${histogram.count}`,
    );
    lines.push(
      `${baseName}_sum${renderLabels({ [labelName]: labelValue })} ${histogram.sum}`,
    );
  }
}

/** Render the Prometheus text exposition snapshot. */
export function renderMetrics(): string {
  const lines: string[] = [];
  renderCounter(
    lines,
    "wms_http_requests_total",
    "Total HTTP requests observed.",
    state.httpRequests,
    ["method", "route", "status_class"],
  );
  renderCounter(
    lines,
    "wms_http_5xx_total",
    "Total HTTP 5xx responses observed.",
    state.http5xx,
    ["route"],
  );
  renderHistogram(
    lines,
    "wms_http_request_duration_ms",
    "HTTP request duration in milliseconds.",
    state.httpDuration,
    "route",
    HTTP_DURATION_BUCKETS_MS,
  );
  renderCounter(
    lines,
    "wms_db_probe_total",
    "Database probe results.",
    state.dbProbe,
    ["db", "outcome"],
  );
  renderHistogram(
    lines,
    "wms_db_probe_duration_ms",
    "Database probe duration in milliseconds.",
    state.dbDuration,
    "db",
    DB_DURATION_BUCKETS_MS,
  );
  if (state.cronRounds.size > 0) {
    lines.push("# HELP wms_cron_rounds_total Cron task rounds observed.");
    lines.push("# TYPE wms_cron_rounds_total counter");
    for (const [key, value] of sortedEntries(state.cronRounds)) {
      const [task, outcome] = splitKey(key);
      lines.push(
        `wms_cron_rounds_total${renderLabels({ task: task ?? "", outcome: outcome ?? "" })} ${value}`,
      );
    }
  }
  if (state.cronLastSuccess.size > 0) {
    lines.push(
      "# HELP wms_cron_last_success_timestamp_seconds Unix timestamp of the last successful cron round.",
    );
    lines.push("# TYPE wms_cron_last_success_timestamp_seconds gauge");
    for (const [task, value] of sortedEntries(state.cronLastSuccess)) {
      lines.push(
        `wms_cron_last_success_timestamp_seconds${renderLabels({ task })} ${value}`,
      );
    }
  }
  if (state.cronConsecutiveFailures.size > 0) {
    lines.push(
      "# HELP wms_cron_consecutive_failures Consecutive failed cron rounds for the task.",
    );
    lines.push("# TYPE wms_cron_consecutive_failures gauge");
    for (const [task, value] of sortedEntries(state.cronConsecutiveFailures)) {
      lines.push(
        `wms_cron_consecutive_failures${renderLabels({ task })} ${value}`,
      );
    }
  }
  if (state.loginFailures.size > 0) {
    lines.push("# HELP wms_login_failures_total Authentication failures by provider and reason.");
    lines.push("# TYPE wms_login_failures_total counter");
    for (const [key, value] of sortedEntries(state.loginFailures)) {
      const [provider, reason] = splitKey(key);
      lines.push(
        `wms_login_failures_total${renderLabels({ provider: provider ?? "", reason: reason ?? "" })} ${value}`,
      );
    }
  }
  if (state.businessFailures.size > 0) {
    lines.push("# HELP wms_business_failures_total Stable business failure signals.");
    lines.push("# TYPE wms_business_failures_total counter");
    for (const [signal, value] of sortedEntries(state.businessFailures)) {
      lines.push(`wms_business_failures_total${renderLabels({ signal })} ${value}`);
    }
  }
  if (state.errorEvents.size > 0) {
    lines.push(
      "# HELP wms_error_events_total Classified server-error events by expected/system kind.",
    );
    lines.push("# TYPE wms_error_events_total counter");
    for (const [key, value] of sortedEntries(state.errorEvents)) {
      const [kind, reason] = splitKey(key);
      lines.push(
        `wms_error_events_total${renderLabels({ kind: kind ?? "", reason: reason ?? "" })} ${value}`,
      );
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Test helper: drop all counters/gauges. */
export function resetMetricsForTests(): void {
  state = createState();
}

export const CRON_HEARTBEAT_FILE_ENV = "CRON_HEARTBEAT_FILE";
export const DEFAULT_CRON_HEARTBEAT_FILE = "/tmp/flower-cron-heartbeat.json";

type CronHeartbeatFile = {
  tasks?: Record<
    string,
    {
      lastSuccessAt?: string | null;
      consecutiveFailures?: number;
      lastRunAt?: string;
      lastOutcome?: string;
    }
  >;
};

/**
 * Copy cron heartbeat state into this process' gauges (web side of E3.4).
 *
 * The cron worker writes the heartbeat after every round. The web process reads
 * it from the shared volume when the metrics route is scraped, so cron status
 * is observable even though the two processes do not share memory. Any read or
 * parse failure is ignored: monitoring data must never break a request.
 */
export function syncCronHeartbeatFromFile(
  filePath: string | undefined = process.env[CRON_HEARTBEAT_FILE_ENV],
): boolean {
  if (typeof filePath !== "string" || filePath.trim() === "") return false;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as CronHeartbeatFile;
    if (!parsed || typeof parsed !== "object" || !parsed.tasks) return false;
    for (const task of CRON_TASKS) {
      const entry = parsed.tasks[task];
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.lastSuccessAt === "string") {
        const successMs = Date.parse(entry.lastSuccessAt);
        if (Number.isFinite(successMs)) {
          state.cronLastSuccess.set(task, Math.floor(successMs / 1000));
        }
      }
      if (
        typeof entry.consecutiveFailures === "number" &&
        Number.isFinite(entry.consecutiveFailures)
      ) {
        state.cronConsecutiveFailures.set(
          task,
          Math.max(0, Math.floor(entry.consecutiveFailures)),
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Map a structured log record to metrics; unknown events are ignored. */
function observeLogRecord(record: Record<string, unknown>): void {
  const event = typeof record.event === "string" ? record.event : "";
  const fields = asRecord(record.fields);

  if (event === "http.request") {
    const route = typeof fields.route === "string" ? fields.route : "";
    // /api/health records its own HTTP metrics directly (see the route), so the sink
    // must not count that request a second time.
    if (route === "/api/health") return;
    recordHttpRequest({
      method: typeof fields.method === "string" ? fields.method : "",
      route,
      status: typeof fields.status === "number" ? fields.status : 0,
      durationMs: typeof fields.durationMs === "number" ? fields.durationMs : 0,
    });
    return;
  }

  // http.health.check and cron.task.round are recorded directly by their producer
  // (health route recordDbProbe, cron daemon recordCronRound), so the sink ignores
  // them to keep a single count path.

  if (event === "auth.login.attempt" && fields.outcome === "failure") {
    recordLoginFailure({
      provider: oneOf(fields.provider, LOGIN_PROVIDERS, "legacy"),
      reason: typeof fields.reason === "string" ? fields.reason : "unknown",
    });
    return;
  }

  if (
    event === "stocktake.confirm" &&
    fields.outcome === "failure" &&
    fields.reason === "negative_stock"
  ) {
    recordBusinessFailure("stock_negative_blocked");
    return;
  }

  // E3.3 emits one `error.server` event for both kinds: `expected` at debug level
  // (countable but never alert-level) and `system` at error level (also delivered).
  if (event === "error.server") {
    recordErrorEvent({
      kind: oneOf(fields.kind, ERROR_EVENT_KINDS, "system"),
      reason: typeof fields.reason === "string" ? fields.reason : "unknown",
    });
  }
}

let sinkInstalled = false;
let previousSink: LogSink | null = null;

/**
 * Install the log-event → metrics bridge exactly once. The previous sink keeps
 * receiving the record, so stdout/stderr logging is unchanged.
 */
export function installMetricsLogSink(): void {
  if (sinkInstalled) return;
  sinkInstalled = true;
  previousSink = getLogSink();
  const forward = previousSink;
  setLogSink((record) => {
    try {
      observeLogRecord(record);
    } catch {
      // Metrics collection must never break logging or a business request.
    }
    forward(record);
  });
}

/** Test helper: restore the sink that was active before installMetricsLogSink. */
export function uninstallMetricsLogSinkForTests(): void {
  if (!sinkInstalled) return;
  sinkInstalled = false;
  if (previousSink) setLogSink(previousSink);
  previousSink = null;
}

// Import-time, idempotent installation for the web and cron processes. Tests opt
// in explicitly so suite state stays deterministic.
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  installMetricsLogSink();
}
