import type { ReactNode } from "react";
import Link from "next/link";

export const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900";
export const button = "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800";
export const card = "rounded-2xl border border-stone-200 bg-white p-5 shadow-sm";
export const tableShell = "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm";
export const tableHead = "border-b border-zinc-100 bg-zinc-50 text-left text-sm text-zinc-600";

export function Field({ label, name, type = "text", required = true, defaultValue }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | number;
}) {
  return <label className="block text-sm text-stone-700">{label}<input className={`${input} mt-1`} name={name} type={type} required={required} defaultValue={defaultValue} /></label>;
}

export function UsageField({ label, name, step, defaultValue, placeholder }: {
  label: string; name: string; step: number; defaultValue?: number; placeholder?: string;
}) {
  return <label className="block text-xs text-stone-600">{label}<input className={`${input} mt-1`} name={name} type="number" min="0" step={step} defaultValue={defaultValue} placeholder={placeholder} /></label>;
}

function ModuleHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-4">
    <div><h2 className="text-2xl font-semibold text-zinc-900">{title}</h2>{description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

function FeedbackBanner({ message, error }: { message?: string; error?: string }) {
  return <>
    {message && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>}
    {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
  </>;
}

export function V2ModulePage({ title, description, actions, message, error, children }: {
  title: string; description?: string; actions?: ReactNode; message?: string; error?: string; children: ReactNode;
}) {
  return <main className="min-h-screen bg-[#f7f7f2] px-4 py-8 text-stone-900 md:px-8">
    <div className="mx-auto max-w-7xl space-y-7">
      <ModuleHeader title={title} description={description} actions={actions} />
      <FeedbackBanner message={message} error={error} />
      {children}
    </div>
  </main>;
}

export function StatusBadge({ tone = "neutral", children }: {
  tone?: "success" | "warning" | "danger" | "info" | "neutral"; children: ReactNode;
}) {
  const tones = {
    success: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-900",
    danger: "bg-red-100 text-red-800",
    info: "bg-sky-100 text-sky-800",
    neutral: "bg-zinc-100 text-zinc-700",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function ActionEmptyState({ title, description, actionHref, actionLabel }: {
  title: string; description: string; actionHref?: string; actionLabel?: string;
}) {
  return <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
    <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500">{description}</p>
    {actionHref && actionLabel && <Link href={actionHref} className={`${button} mt-5 inline-flex`}>{actionLabel}</Link>}
  </div>;
}
