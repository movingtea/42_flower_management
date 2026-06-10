import { Badge } from "@/components/ui/Badge";

export type StatusBadgeKind =
  | "PASS"
  | "WARNING"
  | "CRITICAL"
  | "NOT_STARTED"
  | "OK"
  | "ERROR"
  | "UNKNOWN"
  | "READY"
  | "BLOCKED"
  | "CRITICAL_ISSUE"
  | "WARNING_ISSUE"
  | "SUGGESTION";

const LABELS: Record<StatusBadgeKind, string> = {
  PASS: "已完成",
  WARNING: "需关注",
  CRITICAL: "严重问题",
  NOT_STARTED: "未开始",
  OK: "正常",
  ERROR: "异常",
  UNKNOWN: "未知",
  READY: "可试运行",
  BLOCKED: "阻塞",
  CRITICAL_ISSUE: "严重问题",
  WARNING_ISSUE: "需要关注",
  SUGGESTION: "建议优化",
};

const VARIANTS: Record<
  StatusBadgeKind,
  "default" | "success" | "warning" | "danger" | "info"
> = {
  PASS: "success",
  WARNING: "warning",
  CRITICAL: "danger",
  NOT_STARTED: "default",
  OK: "success",
  ERROR: "danger",
  UNKNOWN: "default",
  READY: "success",
  BLOCKED: "danger",
  CRITICAL_ISSUE: "danger",
  WARNING_ISSUE: "warning",
  SUGGESTION: "info",
};

type Props = {
  status: StatusBadgeKind;
  label?: string;
};

export function StatusBadge({ status, label }: Props) {
  return (
    <Badge variant={VARIANTS[status]}>{label ?? LABELS[status]}</Badge>
  );
}
