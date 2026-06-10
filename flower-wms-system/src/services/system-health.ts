import { access, constants } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { gatherSetupChecklistStats } from "@/services/setup-checklist";
import {
  aggregateHealthStatus,
  type HealthCheckItem,
  type HealthCheckStatus,
} from "@/services/system-health-pure";

export type { HealthCheckItem, HealthCheckStatus };

export type SystemHealthResult = {
  status: "OK" | "WARNING" | "ERROR";
  checks: HealthCheckItem[];
  generatedAt: string;
};

function aggregateHealthStatusForResult(
  checks: HealthCheckItem[]
): SystemHealthResult["status"] {
  return aggregateHealthStatus(checks);
}

function envExists(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0;
}

export async function getSystemHealth(): Promise<SystemHealthResult> {
  const checks: HealthCheckItem[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    const staffCount = await prisma.staffUser.count();
    checks.push({
      key: "database",
      title: "数据库连接",
      status: "OK",
      message: "PostgreSQL 连接正常。",
      metadata: { staffUsers: staffCount },
    });
  } catch (err) {
    checks.push({
      key: "database",
      title: "数据库连接",
      status: "ERROR",
      message:
        err instanceof Error ? err.message : "数据库连接失败",
    });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads");
  try {
    await access(uploadDir, constants.F_OK);
    try {
      await access(uploadDir, constants.W_OK);
      checks.push({
        key: "uploads",
        title: "上传目录",
        status: "OK",
        message: "public/uploads 存在且可写。",
        metadata: { path: uploadDir },
      });
    } catch {
      checks.push({
        key: "uploads",
        title: "上传目录",
        status: "WARNING",
        message: "public/uploads 存在但不可写，上传可能失败。",
        metadata: { path: uploadDir },
      });
    }
  } catch {
    checks.push({
      key: "uploads",
      title: "上传目录",
      status: "WARNING",
      message: "public/uploads 不存在，请在部署层创建或执行首次上传。",
      metadata: { path: uploadDir },
    });
  }

  const envChecks = [
    { key: "DATABASE_URL", label: "DATABASE_URL" },
    { key: "AUTH_SECRET", label: "AUTH_SECRET / NEXTAUTH_SECRET" },
    { key: "NEXTAUTH_SECRET", label: "NEXTAUTH_SECRET" },
  ];
  const authOk =
    envExists("AUTH_SECRET") || envExists("NEXTAUTH_SECRET");
  checks.push({
    key: "environment",
    title: "环境变量",
    status:
      envExists("DATABASE_URL") && authOk ? "OK" : "WARNING",
    message: envExists("DATABASE_URL")
      ? authOk
        ? "关键环境变量已配置（不返回明文）。"
        : "缺少 AUTH_SECRET / NEXTAUTH_SECRET，登录可能异常。"
      : "缺少 DATABASE_URL。",
    metadata: {
      DATABASE_URL: envExists("DATABASE_URL"),
      AUTH_SECRET: envExists("AUTH_SECRET"),
      NEXTAUTH_SECRET: envExists("NEXTAUTH_SECRET"),
      NEXT_PUBLIC_ASSET_BASE_URL: envExists("NEXT_PUBLIC_ASSET_BASE_URL"),
      NEXT_PUBLIC_API_URL: envExists("NEXT_PUBLIC_API_URL"),
    },
  });

  try {
    const stats = await gatherSetupChecklistStats();
    checks.push({
      key: "image_url",
      title: "图片 URL 数据",
      status: stats.localhostImageCount === 0 ? "OK" : "ERROR",
      message:
        stats.localhostImageCount === 0
          ? "未发现 localhost 图片 URL。"
          : `发现 ${stats.localhostImageCount} 处 localhost 图片 URL。`,
      metadata: { localhostCount: stats.localhostImageCount },
    });

    checks.push({
      key: "key_data",
      title: "关键业务数据",
      status:
        stats.activeProductCount > 0 && stats.supplierActiveCount > 0
          ? "OK"
          : "WARNING",
      message: `已上架商品 ${stats.activeProductCount} 个；活跃供应商 ${stats.supplierActiveCount} 个；active 场景入口 ${stats.homeSceneEntryActiveCount} 个。`,
      metadata: {
        activeProducts: stats.activeProductCount,
        suppliers: stats.supplierActiveCount,
        homeSceneEntries: stats.homeSceneEntryActiveCount,
        homeMainItems: stats.homeMainSlotItemCount,
      },
    });
  } catch (err) {
    checks.push({
      key: "key_data",
      title: "关键业务数据",
      status: "WARNING",
      message:
        err instanceof Error ? err.message : "业务数据统计失败",
    });
  }

  checks.push({
    key: "cron",
    title: "定时任务状态",
    status: "UNKNOWN",
    message: "当前未实现 cron 运行状态记录，请查看 flower-cron-worker 部署日志。",
  });

  return {
    status: aggregateHealthStatusForResult(checks),
    checks,
    generatedAt: new Date().toISOString(),
  };
}

export { aggregateHealthStatus } from "@/services/system-health-pure";
