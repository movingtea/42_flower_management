export type DiskStatusLevel = "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";

/** 根据根分区使用率（0–100）返回磁盘健康等级 */
export function getDiskStatusFromPercent(
  usedPercent: number | null | undefined
): DiskStatusLevel {
  if (
    usedPercent == null ||
    !Number.isFinite(usedPercent) ||
    usedPercent < 0 ||
    usedPercent > 100
  ) {
    return "UNKNOWN";
  }
  if (usedPercent >= 90) return "CRITICAL";
  if (usedPercent >= 80) return "WARNING";
  return "OK";
}

/** 将磁盘等级映射为 system-health 检查项状态 */
export function diskStatusToHealthCheckStatus(
  level: DiskStatusLevel
): "OK" | "WARNING" | "ERROR" | "UNKNOWN" {
  switch (level) {
    case "OK":
      return "OK";
    case "WARNING":
      return "WARNING";
    case "CRITICAL":
      return "ERROR";
    case "UNKNOWN":
    default:
      return "UNKNOWN";
  }
}

export function formatDiskUsageMessage(
  level: DiskStatusLevel,
  usedPercent: number,
  options?: { scope?: "host" | "container" }
): string {
  const scope =
    options?.scope === "container"
      ? "（容器内视图；宿主机请运行 ops:disk）"
      : "";
  switch (level) {
    case "OK":
      return `根分区使用率 ${usedPercent.toFixed(1)}%，状态正常。${scope}`;
    case "WARNING":
      return `根分区使用率 ${usedPercent.toFixed(1)}%（≥80%），建议清理 Docker 缓存/日志或扩容。${scope}`;
    case "CRITICAL":
      return `根分区使用率 ${usedPercent.toFixed(1)}%（≥90%），磁盘空间严重不足，可能导致 PostgreSQL / Prisma / 容器 unhealthy。${scope}`;
    default:
      return `无法解析磁盘使用率。${scope}`;
  }
}
