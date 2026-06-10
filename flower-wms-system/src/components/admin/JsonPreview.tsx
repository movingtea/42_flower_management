"use client";

import { useMemo, useState } from "react";

type Props = {
  value: unknown;
  label?: string;
  collapseThreshold?: number;
};

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function JsonPreview({
  value,
  label,
  collapseThreshold = 1200,
}: Props) {
  const text = useMemo(() => formatJson(value), [value]);
  const isLong = text.length > collapseThreshold;
  const [expanded, setExpanded] = useState(!isLong);

  if (value === null || value === undefined) {
    return <span className="text-sm text-zinc-400">—</span>;
  }

  return (
    <div className="space-y-1">
      {label ? (
        <p className="text-xs font-medium text-zinc-500">{label}</p>
      ) : null}
      <pre
        className={`overflow-x-auto rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-700 ${
          isLong && !expanded ? "max-h-32" : "max-h-96"
        }`}
      >
        {isLong && !expanded ? `${text.slice(0, collapseThreshold)}…` : text}
      </pre>
      {isLong ? (
        <button
          type="button"
          className="text-xs text-emerald-700 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开全部"}
        </button>
      ) : null}
    </div>
  );
}
