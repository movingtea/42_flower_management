import Link from "next/link";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { DataQualityIssue } from "@/services/data-quality-pure";

type Props = {
  issue: DataQualityIssue;
};

function severityBadge(severity: DataQualityIssue["severity"]) {
  if (severity === "CRITICAL") return <StatusBadge status="CRITICAL_ISSUE" />;
  if (severity === "WARNING") return <StatusBadge status="WARNING_ISSUE" />;
  return <StatusBadge status="SUGGESTION" />;
}

export function DataQualityIssueCard({ issue }: Props) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {severityBadge(issue.severity)}
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {issue.domain}
            </span>
            <span className="text-xs text-zinc-400">{issue.entityType}</span>
          </div>
          <h3 className="text-sm font-semibold text-zinc-900">{issue.title}</h3>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{issue.message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        {issue.entityId ? <span>对象 ID：{issue.entityId}</span> : null}
        {issue.metadata && Object.keys(issue.metadata).length > 0 ? (
          <span>
            {Object.entries(issue.metadata)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · ")}
          </span>
        ) : null}
      </div>
      {issue.actionHref && issue.actionLabel ? (
        <Link
          href={issue.actionHref}
          className="mt-3 inline-flex text-sm font-medium text-emerald-700 hover:underline"
        >
          {issue.actionLabel} →
        </Link>
      ) : null}
    </article>
  );
}
