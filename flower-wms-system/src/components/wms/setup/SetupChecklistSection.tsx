import Link from "next/link";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type {
  SetupChecklistItem,
  SetupChecklistSection,
} from "@/services/setup-checklist-pure";

const STATUS_ICON: Record<SetupChecklistItem["status"], string> = {
  PASS: "✓",
  WARNING: "!",
  CRITICAL: "✕",
  NOT_STARTED: "○",
};

type Props = {
  section: SetupChecklistSection;
};

export function SetupChecklistSection({ section }: Props) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">{section.title}</h3>
        <StatusBadge status={section.status} />
      </div>
      <ul className="space-y-3">
        {section.items.map((item) => (
          <li
            key={item.key}
            className="rounded-lg border border-zinc-100 bg-zinc-50/50 px-4 py-3"
          >
            <div className="flex flex-wrap items-start gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-zinc-600 ring-1 ring-zinc-200"
                aria-hidden
              >
                {STATUS_ICON[item.status]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-zinc-900">{item.title}</p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-sm text-zinc-600">{item.message}</p>
                {item.metrics && Object.keys(item.metrics).length > 0 ? (
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {Object.entries(item.metrics).map(([key, val]) => (
                      <div key={key}>
                        <span className="text-zinc-400">{key}：</span>
                        <span>{String(val)}</span>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {item.actionHref && item.actionLabel ? (
                  <Link
                    href={item.actionHref}
                    className="mt-2 inline-flex text-sm font-medium text-emerald-700 hover:underline"
                  >
                    {item.actionLabel} →
                  </Link>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
