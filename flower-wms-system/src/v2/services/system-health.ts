import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../../generated/prisma-v2/client";
import {
  getStorageConfig,
  isOssStorageConfigured,
  type StorageConfig,
} from "@/lib/storage/config";
import {
  aggregateHealthStatus,
  describeEnvPresence,
  evaluateMigrationState,
  formatDiskMessage,
  isMissingMigrationTable,
  redactConnectionStrings,
  type AppliedMigration,
  type HealthCheckItem,
  type HealthCheckStatus,
  type MigrationState,
} from "../domain/system-health";

export type SystemHealthResult = {
  status: "OK" | "WARNING" | "ERROR";
  checks: HealthCheckItem[];
  migrationState: MigrationState | null;
  generatedAt: Date;
};

export type SystemHealthOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  checkDisk?: boolean;
  storageConfig?: StorageConfig;
  localMigrationNames?: string[];
  cwd?: string;
};

const DEFAULT_LOCAL_MIGRATION_DIR = ["prisma", "v2", "migrations"];

async function readLocalMigrationNames(cwd: string): Promise<string[]> {
  const entries = await readdir(join(cwd, ...DEFAULT_LOCAL_MIGRATION_DIR), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

async function checkDiskUsage(cwd: string): Promise<{ status: HealthCheckStatus; message: string; metadata: Record<string, unknown> }> {
  try {
    const { statfs } = await import("node:fs/promises");
    const stats = await statfs(cwd) as unknown as {
      bsize: number | bigint;
      blocks: number | bigint;
      bavail: number | bigint;
    };
    const blocks = Number(stats.blocks);
    const available = Number(stats.bavail);
    if (!Number.isFinite(blocks) || blocks <= 0 || !Number.isFinite(available)) {
      return {
        status: "UNKNOWN",
        message: "无法解析当前应用所在磁盘的容量信息。",
        metadata: {},
      };
    }
    const usedPercent = ((blocks - available) / blocks) * 100;
    const result = formatDiskMessage(usedPercent);
    return {
      status: result.status,
      message: result.message,
      metadata: { usedPercent: Math.round(usedPercent * 10) / 10 },
    };
  } catch {
    return {
      status: "UNKNOWN",
      message: "当前运行环境不提供磁盘使用率；请在宿主机运行 npm run ops:disk。",
      metadata: {},
    };
  }
}

function envExists(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Read-only V2 system health. Only booleans and counts leave this service; no
 * connection string, secret or AccessKey is ever included in a check message.
 */
export async function getV2SystemHealth(
  db: PrismaClient,
  options: SystemHealthOptions = {},
): Promise<SystemHealthResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const checks: HealthCheckItem[] = [];

  let migrationState: MigrationState | null = null;

  // ----------------------------------------------------------- V2 database
  let databaseOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    const [tenantCount, storeCount, materialCount, skuCount] = await Promise.all([
      db.tenant.count(),
      db.store.count(),
      db.material.count(),
      db.productSku.count(),
    ]);
    databaseOk = true;
    checks.push({
      key: "v2_database",
      title: "V2 数据库连接",
      status: tenantCount > 0 && storeCount > 0 ? "OK" : "WARNING",
      message: tenantCount > 0 && storeCount > 0
        ? `V2 PostgreSQL 连接正常（租户 ${tenantCount}、门店 ${storeCount}、物料 ${materialCount}、SKU ${skuCount}）。`
        : "V2 PostgreSQL 可连接，但缺少租户或门店，请检查 seed。",
      metadata: { tenantCount, storeCount, materialCount, skuCount },
    });
  } catch (error) {
    checks.push({
      key: "v2_database",
      title: "V2 数据库连接",
      status: "ERROR",
      message: error instanceof Error
        ? `V2 PostgreSQL 连接失败：${redactConnectionStrings(error.message)}`
        : "V2 PostgreSQL 连接失败。",
    });
  }

  // ------------------------------------------------------------ migrations
  if (databaseOk) {
    try {
      const localMigrations = options.localMigrationNames
        ?? await readLocalMigrationNames(cwd);
      const applied = await db.$queryRaw<AppliedMigration[]>`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
      migrationState = evaluateMigrationState(localMigrations, applied);
      checks.push({
        key: "v2_migrations",
        title: "V2 数据库迁移",
        status: migrationState.status,
        message: migrationState.message,
        metadata: {
          pending: migrationState.pending.length,
          failed: migrationState.failed.length,
          appliedNotInCode: migrationState.appliedNotInCode.length,
          latestLocal: migrationState.latestLocal,
          latestApplied: migrationState.latestApplied,
        },
      });
    } catch (error) {
      if (isMissingMigrationTable(error)) {
        checks.push({
          key: "v2_migrations",
          title: "V2 数据库迁移",
          status: "ERROR",
          message:
            "V2 迁移表 _prisma_migrations 不存在：数据库可能尚未初始化，或连接到了错误数据库。"
            + "请在部署窗口执行 npm run db:v2:migrate:deploy，不要在本页直接操作数据库。",
          metadata: { migrationTableMissing: true },
        });
      } else {
        checks.push({
          key: "v2_migrations",
          title: "V2 数据库迁移",
          status: "ERROR",
          message: error instanceof Error
            ? `无法读取 V2 迁移状态：${redactConnectionStrings(error.message)}`
            : "无法读取 V2 迁移状态。",
        });
      }
    }
  } else {
    checks.push({
      key: "v2_migrations",
      title: "V2 数据库迁移",
      status: "UNKNOWN",
      message: "V2 数据库不可用，跳过迁移状态检查。",
    });
  }

  // ---------------------------------------------------------- environment
  const envPresence = {
    V2_DATABASE_URL: envExists(env, "V2_DATABASE_URL"),
    AUTH_SECRET: envExists(env, "AUTH_SECRET") || envExists(env, "NEXTAUTH_SECRET"),
    NEXTAUTH_URL: envExists(env, "NEXTAUTH_URL"),
  };
  const envResult = describeEnvPresence(
    ["V2_DATABASE_URL", "AUTH_SECRET", "NEXTAUTH_URL"],
    envPresence,
  );
  checks.push({
    key: "environment",
    title: "关键环境变量",
    status: envResult.status,
    message: envResult.message,
    metadata: envPresence,
  });

  // -------------------------------------------------------------- storage
  let storageConfig: StorageConfig | null;
  try {
    storageConfig = options.storageConfig ?? getStorageConfig();
  } catch {
    checks.push({
      key: "storage",
      title: "对象存储与上传",
      status: "UNKNOWN",
      message: "无法读取存储配置。",
    });
    storageConfig = null;
  }
  if (storageConfig) {
    const configured = isOssStorageConfigured(storageConfig);
    checks.push({
      key: "storage",
      title: "对象存储与上传",
      status: storageConfig.enableOssUpload
        ? configured
          ? "OK"
          : "ERROR"
        : "WARNING",
      message: storageConfig.enableOssUpload
        ? configured
          ? `OSS 配置完整（bucket=${storageConfig.bucket}，上传与公网地址均已配置；不返回 AccessKey）。`
          : "已启用 OSS 上传，但 bucket、Endpoint、公网地址或 AccessKey 不完整。"
        : "未启用 OSS 上传（ENABLE_OSS_UPLOAD=false 或 STORAGE_DRIVER≠oss）。",
      metadata: {
        driver: storageConfig.driver,
        enableOssUpload: storageConfig.enableOssUpload,
        bucket: storageConfig.bucket,
        hasAccessKeyId: Boolean(storageConfig.accessKeyId),
        hasAccessKeySecret: Boolean(storageConfig.accessKeySecret),
        legacyUploads: storageConfig.enableLegacyUploads,
      },
    });
  }

  // ----------------------------------------------------------------- disk
  if (options.checkDisk !== false) {
    checks.push({
      key: "disk",
      title: "磁盘空间",
      ...(await checkDiskUsage(cwd)),
    });
  } else {
    checks.push({
      key: "disk",
      title: "磁盘空间",
      status: "UNKNOWN",
      message: "本次检查跳过了磁盘探测。",
    });
  }

  // ------------------------------------------------- V2 key data + audit
  if (databaseOk) {
    try {
      const [tenantCount, storeCount, materialCount, activeSkuCount] = await Promise.all([
        db.tenant.count(),
        db.store.count(),
        db.material.count({ where: { active: true } }),
        db.productSku.count({ where: { active: true } }),
      ]);
      checks.push({
        key: "key_data",
        title: "V2 关键业务数据",
        status: tenantCount > 0 && storeCount > 0 && materialCount > 0 ? "OK" : "WARNING",
        message: `租户 ${tenantCount}、门店 ${storeCount}、启用物料 ${materialCount}、启用 SKU ${activeSkuCount}。`,
        metadata: { tenantCount, storeCount, materialCount, activeSkuCount },
      });

      const latestAudit = await db.auditEvent.findFirst({
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true, action: true },
      });
      const ageMs = latestAudit ? now.getTime() - latestAudit.occurredAt.getTime() : null;
      checks.push({
        key: "audit",
        title: "审计事件",
        status: ageMs == null ? "WARNING" : ageMs > 7 * 86_400_000 ? "WARNING" : "OK",
        message: latestAudit
          ? ageMs != null && ageMs > 7 * 86_400_000
            ? `最近审计事件在 ${latestAudit.occurredAt.toISOString()}，已超过 7 天。`
            : `最近审计事件：${latestAudit.action}（${latestAudit.occurredAt.toISOString()}）。`
          : "尚无审计事件，完成关键业务操作后再检查。",
      });
    } catch (error) {
      checks.push({
        key: "key_data",
        title: "V2 关键业务数据",
        status: "WARNING",
        message: error instanceof Error
          ? redactConnectionStrings(error.message)
          : "V2 关键业务数据统计失败。",
      });
    }
  }

  return {
    status: aggregateHealthStatus(checks),
    checks,
    migrationState,
    generatedAt: now,
  };
}
