export type TrialRunStepStatus = "PASS" | "WARNING" | "BLOCKED";

export type TrialRunStep = {
  key: string;
  title: string;
  status: TrialRunStepStatus;
  message: string;
  actionHref?: string;
  metadata?: Record<string, unknown>;
};

export function aggregateTrialRunStatus(
  steps: TrialRunStep[]
): "READY" | "WARNING" | "BLOCKED" {
  if (steps.some((s) => s.status === "BLOCKED")) return "BLOCKED";
  if (steps.some((s) => s.status === "WARNING")) return "WARNING";
  return "READY";
}
