/**
 * Cron worker：虚拟库存投影 + 过期待支付订单关闭。
 * 由 docker-compose flower-cron-worker 启动。
 *
 * Each task round is one structured `cron.task.round` triple (started →
 * success|failure) sharing a fresh run ID, so container logs correlate without
 * the old free-text timestamps. Polling intervals, task order and exit
 * semantics are unchanged.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "../src/lib/prisma";
import { logEvent } from "../src/lib/observability/logger";
import { recordCronRound } from "../src/lib/observability/metrics";
import { syncPhysicalStockToVirtual } from "../src/services/inventory-sync";
import { closeExpiredPendingOrders } from "../src/services/order-lifecycle";

const INVENTORY_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.INVENTORY_SYNC_INTERVAL_MS ?? 15 * 60 * 1000)
);

const ORDER_EXPIRY_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.ORDER_EXPIRY_INTERVAL_MS ?? 60 * 1000)
);

/** Heartbeat file consumed by the staging cron healthcheck (E3.4). */
const HEARTBEAT_FILE =
  process.env.CRON_HEARTBEAT_FILE ?? "/tmp/flower-cron-heartbeat.json";

type CronTaskName = "inventory-sync" | "order-expiry";

type SafeCounts = { affected?: number; scanned?: number };

let lastInventoryRun = 0;
let lastOrderExpiryRun = 0;

type HeartbeatOutcome = "success" | "failure";

type HeartbeatTaskState = {
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastRunAt: string;
  lastOutcome: HeartbeatOutcome;
};

const heartbeatTasks: Record<string, HeartbeatTaskState> = {};

/** Best-effort restore so a restart continues the consecutive-failure counter. */
async function loadHeartbeat(): Promise<void> {
  try {
    const raw = await readFile(HEARTBEAT_FILE, "utf8");
    const parsed = JSON.parse(raw) as {
      tasks?: Record<string, Partial<HeartbeatTaskState>>;
    };
    if (!parsed?.tasks || typeof parsed.tasks !== "object") return;
    for (const [task, value] of Object.entries(parsed.tasks)) {
      if (!value || typeof value !== "object") continue;
      heartbeatTasks[task] = {
        lastSuccessAt:
          typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : null,
        consecutiveFailures:
          Number.isInteger(value.consecutiveFailures) && value.consecutiveFailures! >= 0
            ? value.consecutiveFailures!
            : 0,
        lastRunAt:
          typeof value.lastRunAt === "string"
            ? value.lastRunAt
            : new Date(0).toISOString(),
        lastOutcome: value.lastOutcome === "success" ? "success" : "failure",
      };
    }
  } catch {
    // First run, missing file or unreadable content: start from an empty heartbeat.
  }
}

/** Write the heartbeat after a round. Never let monitoring I/O change cron semantics. */
async function writeHeartbeat(
  task: CronTaskName,
  outcome: HeartbeatOutcome
): Promise<void> {
  const now = new Date().toISOString();
  const current = heartbeatTasks[task];
  heartbeatTasks[task] = {
    lastSuccessAt:
      outcome === "success" ? now : (current?.lastSuccessAt ?? null),
    consecutiveFailures:
      outcome === "success" ? 0 : (current?.consecutiveFailures ?? 0) + 1,
    lastRunAt: now,
    lastOutcome: outcome,
  };
  try {
    await mkdir(dirname(HEARTBEAT_FILE), { recursive: true });
    await writeFile(
      HEARTBEAT_FILE,
      `${JSON.stringify({ updatedAt: now, tasks: heartbeatTasks })}\n`,
      "utf8"
    );
  } catch {
    // Heartbeat is monitoring state, not a business write; keep the worker running.
  }
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Project only plain counts; task result objects may hold business rows. */
function safeCounts(task: CronTaskName, result: unknown): SafeCounts | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const candidate = result as Record<string, unknown>;
  const scanned = safeCount(candidate.scanned);
  const affected = safeCount(
    task === "inventory-sync" ? candidate.clamped : candidate.closed
  );
  const counts: SafeCounts = {};
  if (scanned !== undefined) counts.scanned = scanned;
  if (affected !== undefined) counts.affected = affected;
  return Object.keys(counts).length === 0 ? undefined : counts;
}

async function runTask<T>(task: CronTaskName, run: () => Promise<T>): Promise<T> {
  const runId = randomUUID();
  const startedAt = Date.now();

  logEvent({
    level: "info",
    event: "cron.task.round",
    runId,
    fields: { task, outcome: "started", durationMs: 0 },
  });

  try {
    const result = await run();
    const counts = safeCounts(task, result);
    const durationMs = Date.now() - startedAt;
    recordCronRound({ task, outcome: "success", durationMs, counts });
    await writeHeartbeat(task, "success");
    logEvent({
      level: "info",
      event: "cron.task.round",
      runId,
      fields: {
        task,
        outcome: "success",
        durationMs,
        ...(counts === undefined ? {} : { counts }),
      },
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordCronRound({ task, outcome: "failure", durationMs });
    await writeHeartbeat(task, "failure");
    logEvent({
      level: "error",
      event: "cron.task.round",
      runId,
      fields: {
        task,
        outcome: "failure",
        durationMs,
        reason: "internal_error",
      },
      error,
    });
    throw error;
  }
}

async function runInventorySync() {
  return runTask("inventory-sync", () => syncPhysicalStockToVirtual());
}

async function runOrderExpiry() {
  return runTask("order-expiry", () => closeExpiredPendingOrders());
}

async function tick() {
  const now = Date.now();
  if (now - lastInventoryRun >= INVENTORY_INTERVAL_MS) {
    lastInventoryRun = now;
    try {
      await runInventorySync();
    } catch {
      // The round failure is already emitted as cron.task.round; the worker keeps running.
    }
  }

  if (now - lastOrderExpiryRun >= ORDER_EXPIRY_INTERVAL_MS) {
    lastOrderExpiryRun = now;
    try {
      await runOrderExpiry();
    } catch {
      // The round failure is already emitted as cron.task.round; the worker keeps running.
    }
  }
}

async function main() {
  await loadHeartbeat();
  logEvent({
    level: "info",
    event: "cron.worker.started",
    fields: {
      pid: process.pid,
      inventoryIntervalMs: INVENTORY_INTERVAL_MS,
      orderExpiryIntervalMs: ORDER_EXPIRY_INTERVAL_MS,
    },
  });
  for (;;) {
    try {
      await tick();
    } catch {
      // Defensive: one tick must never terminate the polling loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
