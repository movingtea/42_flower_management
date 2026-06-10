export type HealthCheckStatus = "OK" | "WARNING" | "ERROR" | "UNKNOWN";

export type HealthCheckItem = {
  key: string;
  title: string;
  status: HealthCheckStatus;
  message: string;
  metadata?: Record<string, unknown>;
};

export function aggregateHealthStatus(
  checks: HealthCheckItem[]
): "OK" | "WARNING" | "ERROR" {
  if (checks.some((c) => c.status === "ERROR")) return "ERROR";
  if (checks.some((c) => c.status === "WARNING")) return "WARNING";
  return "OK";
}
