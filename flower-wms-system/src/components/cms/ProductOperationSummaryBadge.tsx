"use client";

import { Badge } from "@/components/ui/Badge";
import type { PublishReadinessStatus } from "@/services/cms-product-validation-pure";

const READINESS_LABELS: Record<PublishReadinessStatus, string> = {
  READY: "可上架",
  WARNING: "需检查",
  BLOCKED: "不可上架",
  INCOMPLETE: "信息不完整",
};

const READINESS_VARIANTS: Record<
  PublishReadinessStatus,
  "success" | "warning" | "danger" | "default" | "info"
> = {
  READY: "success",
  WARNING: "warning",
  BLOCKED: "danger",
  INCOMPLETE: "default",
};

type Props = {
  status: PublishReadinessStatus | string | null | undefined;
  score?: number | null;
  canPromote?: boolean | null;
};

export function ProductOperationSummaryBadge({
  status,
  score,
  canPromote,
}: Props) {
  if (!status) return <Badge variant="default">未校验</Badge>;

  const key = status as PublishReadinessStatus;
  const label = READINESS_LABELS[key] ?? status;

  return (
    <div className="space-y-1">
      <Badge variant={READINESS_VARIANTS[key] ?? "default"}>{label}</Badge>
      {score != null ? (
        <p className="text-[11px] text-zinc-500">完整度 {score}</p>
      ) : null}
      {canPromote === false ? (
        <p className="text-[11px] text-amber-700">不建议主推</p>
      ) : null}
    </div>
  );
}
