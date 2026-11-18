/**
 * Pure V2 system-health rules.
 *
 * Database, filesystem and environment probes live in the service; this module
 * owns the deterministic status aggregation and migration comparison so both
 * can be unit tested.
 */

export type HealthCheckStatus = "OK" | "WARNING" | "ERROR" | "UNKNOWN";

export type HealthCheckItem = {
  key: string;
  title: string;
  status: HealthCheckStatus;
  message: string;
  metadata?: Record<string, unknown>;
};

export function aggregateHealthStatus(
  checks: readonly HealthCheckItem[],
): "OK" | "WARNING" | "ERROR" {
  if (checks.some((check) => check.status === "ERROR")) return "ERROR";
  if (checks.some((check) => check.status === "WARNING")) return "WARNING";
  return "OK";
}

export type AppliedMigration = {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
};

export type MigrationState = {
  status: HealthCheckStatus;
  message: string;
  pending: string[];
  failed: string[];
  appliedNotInCode: string[];
  latestLocal: string | null;
  latestApplied: string | null;
};

function isComplete(row: AppliedMigration): boolean {
  return row.finished_at != null && row.rolled_back_at == null;
}

/**
 * Health messages are user-facing. Even when a driver error echoes the datasource
 * URL, the page must never expose a connection string or its password.
 */
const CONNECTION_URL_PATTERN = /(postgres(?:ql)?:\/\/)[^\s"'`]+/gi;

export function redactConnectionStrings(message: string): string {
  return message.replace(CONNECTION_URL_PATTERN, "$1***");
}

/**
 * Detects the "database reachable but never migrated" case so the page can give
 * a migration-specific message instead of a raw driver error.
 */
export function isMissingMigrationTable(error: unknown): boolean {
  const record = (error ?? {}) as {
    code?: unknown;
    meta?: { code?: unknown };
    message?: unknown;
  };
  const code = typeof record.code === "string" ? record.code : "";
  const metaCode = typeof record.meta?.code === "string" ? record.meta.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (!message.includes("_prisma_migrations")) return false;
  return (
    code === "P2021"
    || metaCode === "42P01"
    || message.includes("42P01")
    || /does not exist|不存在/i.test(message)
  );
}

/**
 * Compares the local migration directory with `_prisma_migrations`.
 *
 * - a rolled-back or unfinished applied row is an ERROR;
 * - local migrations that were never applied are a WARNING;
 * - applied migrations missing from the code checkout are a WARNING (database
 *   and code are on different revisions).
 */
export function evaluateMigrationState(
  localMigrationNames: readonly string[],
  applied: readonly AppliedMigration[],
): MigrationState {
  const local = [...new Set(localMigrationNames.filter((name) => name.trim().length > 0))].sort();
  const appliedNames = new Set(applied.map((row) => row.migration_name));
  const failed = applied
    .filter((row) => !isComplete(row))
    .map((row) => row.migration_name)
    .sort();
  const pending = local.filter((name) => !appliedNames.has(name));
  const appliedNotInCode = [...appliedNames].filter((name) => !local.includes(name)).sort();
  const latestLocal = local.length > 0 ? local[local.length - 1] : null;
  // Only completed rows count as applied: a rolled-back or crashed migration must
  // not be presented as the current database revision.
  const completedApplied = applied
    .filter(isComplete)
    .map((row) => row.migration_name)
    .sort();
  const latestApplied = completedApplied.length > 0
    ? completedApplied[completedApplied.length - 1]
    : null;

  if (local.length === 0) {
    return {
      status: "WARNING",
      message: "无法读取本地 V2 迁移目录，不能确认数据库迁移是否完整。",
      pending: [],
      failed,
      appliedNotInCode,
      latestLocal: null,
      latestApplied,
    };
  }
  if (failed.length > 0) {
    return {
      status: "ERROR",
      message: `有 ${failed.length} 条 V2 迁移失败或回滚：${failed.join("、")}。`,
      pending,
      failed,
      appliedNotInCode,
      latestLocal,
      latestApplied,
    };
  }
  if (pending.length > 0) {
    return {
      status: "WARNING",
      message: `有 ${pending.length} 条 V2 迁移尚未应用：${pending.join("、")}。请执行 npm run db:v2:migrate:deploy。`,
      pending,
      failed,
      appliedNotInCode,
      latestLocal,
      latestApplied,
    };
  }
  if (appliedNotInCode.length > 0) {
    return {
      status: "WARNING",
      message: `数据库包含代码目录中不存在的迁移：${appliedNotInCode.join("、")}，请确认部署版本。`,
      pending,
      failed,
      appliedNotInCode,
      latestLocal,
      latestApplied,
    };
  }
  return {
    status: "OK",
    message: `V2 迁移已全部应用，共 ${local.length} 条，最新为 ${latestLocal}。`,
    pending,
    failed,
    appliedNotInCode,
    latestLocal,
    latestApplied,
  };
}

export type EnvPresence = Record<string, boolean>;

/** Safe env summary: booleans only, never the value. */
export function describeEnvPresence(required: readonly string[], env: EnvPresence): {
  status: HealthCheckStatus;
  message: string;
  missing: string[];
} {
  const missing = required.filter((key) => !env[key]);
  return {
    status: missing.length === 0 ? "OK" : "WARNING",
    message:
      missing.length === 0
        ? `关键环境变量已配置（${required.join("、")}；不返回明文）。`
        : `缺少环境变量：${missing.join("、")}。`,
    missing,
  };
}

export function diskStatusToHealthStatus(status: "OK" | "WARNING" | "CRITICAL" | "UNKNOWN"): HealthCheckStatus {
  switch (status) {
    case "OK":
      return "OK";
    case "WARNING":
      return "WARNING";
    case "CRITICAL":
      return "ERROR";
    default:
      return "UNKNOWN";
  }
}

export function formatDiskMessage(usedPercent: number | null, scope = "当前应用所在磁盘"): {
  status: HealthCheckStatus;
  message: string;
} {
  if (usedPercent == null || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return { status: "UNKNOWN", message: `无法读取${scope}使用率。` };
  }
  if (usedPercent >= 90) {
    return {
      status: "ERROR",
      message: `${scope}使用率 ${usedPercent.toFixed(1)}%（≥90%），磁盘空间严重不足。`,
    };
  }
  if (usedPercent >= 80) {
    return {
      status: "WARNING",
      message: `${scope}使用率 ${usedPercent.toFixed(1)}%（≥80%），建议清理缓存或扩容。`,
    };
  }
  return { status: "OK", message: `${scope}使用率 ${usedPercent.toFixed(1)}%，状态正常。` };
}
