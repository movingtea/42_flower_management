import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  diskStatusToHealthCheckStatus,
  formatDiskUsageMessage,
  getDiskStatusFromPercent,
  type DiskStatusLevel,
} from "@/lib/system-health/disk-status";
import type { HealthCheckItem } from "@/services/system-health-pure";

const execFileAsync = promisify(execFile);

export type DiskUsageSnapshot = {
  mountPoint: string;
  totalKb: number;
  usedKb: number;
  availableKb: number;
  usedPercent: number;
  level: DiskStatusLevel;
  scope: "container" | "host";
};

function parseDfLine(line: string): Omit<DiskUsageSnapshot, "level" | "scope"> | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;

  const totalKb = Number.parseInt(parts[1], 10);
  const usedKb = Number.parseInt(parts[2], 10);
  const availableKb = Number.parseInt(parts[3], 10);
  const usedPercent = Number.parseInt(parts[4].replace("%", ""), 10);
  const mountPoint = parts[5];

  if (
    !Number.isFinite(totalKb) ||
    !Number.isFinite(usedKb) ||
    !Number.isFinite(availableKb) ||
    !Number.isFinite(usedPercent)
  ) {
    return null;
  }

  return { mountPoint, totalKb, usedKb, availableKb, usedPercent };
}

function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

async function detectScope(): Promise<"container" | "host"> {
  try {
    await access("/.dockerenv");
    return "container";
  } catch {
    return "host";
  }
}

/** 读取根分区 df（POSIX -kP）；失败返回 null，不抛错 */
export async function getRootDiskUsage(
  mountPoint = "/"
): Promise<DiskUsageSnapshot | null> {
  try {
    const { stdout } = await execFileAsync("df", ["-kP", mountPoint], {
      timeout: 5000,
    });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return null;

    const parsed = parseDfLine(lines[1]);
    if (!parsed) return null;

    const level = getDiskStatusFromPercent(parsed.usedPercent);
    const scope = await detectScope();

    return { ...parsed, level, scope };
  } catch {
    return null;
  }
}

export async function buildDiskHealthCheckItem(): Promise<HealthCheckItem> {
  const snapshot = await getRootDiskUsage("/");

  if (!snapshot) {
    return {
      key: "disk_space",
      title: "磁盘空间",
      status: "UNKNOWN",
      message:
        "无法读取磁盘使用率（当前环境可能禁止 df）。宿主机请运行：npm run ops:disk",
    };
  }

  const status = diskStatusToHealthCheckStatus(snapshot.level);

  return {
    key: "disk_space",
    title: "磁盘空间",
    status,
    message: formatDiskUsageMessage(snapshot.level, snapshot.usedPercent, {
      scope: snapshot.scope,
    }),
    metadata: {
      mountPoint: snapshot.mountPoint,
      total: formatKb(snapshot.totalKb),
      used: formatKb(snapshot.usedKb),
      available: formatKb(snapshot.availableKb),
      usedPercent: `${snapshot.usedPercent}%`,
      level: snapshot.level,
      scope: snapshot.scope,
      checkedAt: new Date().toISOString(),
    },
  };
}
