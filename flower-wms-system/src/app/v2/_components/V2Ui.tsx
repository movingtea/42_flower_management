import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Shared V2 visual primitives.
 *
 * These are intentionally thin: the project keeps semantic tables and plain GET
 * forms instead of a data-grid abstraction. Pages opt in to the table pattern
 * with `V2Table`; the sticky rightmost action classes are never applied by a
 * global selector, so V1 and existing V2 tables keep their current behaviour.
 */

export const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
export const button =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
export const dangerButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60";
export const card = "rounded-2xl border border-stone-200 bg-white p-5 shadow-sm";

/** Legacy table shell retained for existing V2 tables; new tables use `V2Table`. */
export const tableShell = "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm";
export const tableHead = "border-b border-zinc-100 bg-zinc-50 text-left text-sm text-zinc-600";

/** Shared desktop table pattern: scroll container, one-field-per-column, sticky actions. */
export const dataTableHead =
  "border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500";
export const dataTableBody = "divide-y divide-stone-100";
export const numericHead = "px-4 py-3 text-right";
export const numericCell = "px-4 py-3 text-right tabular-nums";
/** Opt-in rightmost action column; opaque backgrounds keep cells readable while scrolling. */
export const stickyActionHead =
  "sticky right-0 z-20 w-56 border-l border-stone-200 bg-stone-50 px-4 py-3 text-left";
export const stickyActionCell =
  "sticky right-0 z-10 w-56 border-l border-stone-200 bg-white px-4 py-3 align-top";
export const stickyActionCellMuted =
  "sticky right-0 z-10 w-56 border-l border-stone-200 bg-stone-50 px-4 py-3 align-top";

export type V2Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_ACCENT: Record<V2Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  warning: "bg-amber-50 text-amber-700 ring-amber-100",
  danger: "bg-rose-50 text-rose-700 ring-rose-100",
  info: "bg-sky-50 text-sky-700 ring-sky-100",
  neutral: "bg-stone-50 text-stone-600 ring-stone-200",
};

const TONE_BAR: Record<V2Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-500",
  neutral: "bg-stone-400",
};

/**
 * Compact metric card for dashboard/overview pages. It is a link when `href`
 * is supplied, otherwise a plain tile; the number stays the dominant element.
 */
export function V2StatCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
  icon,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: V2Tone;
  icon?: ReactNode;
  footer?: ReactNode;
}) {
  const body = <div className="flex h-full flex-col gap-2">
    <div className="flex items-start justify-between gap-3">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      {icon ? (
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ring-1 ring-inset ${TONE_ACCENT[tone]}`} aria-hidden>
          {icon}
        </span>
      ) : null}
    </div>
    <p className="text-2xl font-semibold tracking-tight tabular-nums text-stone-900">{value}</p>
    {hint ? <p className="text-xs leading-5 text-stone-500">{hint}</p> : null}
    {footer ? <div className="mt-auto pt-1 text-xs font-medium text-emerald-800">{footer}</div> : null}
  </div>;
  const className = `${card} h-full transition ${href ? "hover:border-emerald-300 hover:shadow-md" : ""}`;
  return href ? <Link href={href} className={`block ${className}`}>{body}</Link> : <div className={className}>{body}</div>;
}

/** White panel with a consistent header, used as the main content grouping. */
export function V2Section({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <section className={`${card} min-w-0 ${className}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    {children}
  </section>;
}

/** Accessible progress bar; callers clamp domain quantities before rendering. */
export function V2Progress({
  value,
  max,
  tone = "success",
  label,
}: {
  value: number;
  max: number;
  tone?: V2Tone;
  label?: string;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const percent = safeMax > 0 ? Math.min(100, Math.max(0, Math.round((safeValue / safeMax) * 100))) : 0;
  return <div className="min-w-0">
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
    >
      <div className={`h-full rounded-full transition-[width] ${TONE_BAR[tone]}`} style={{ width: `${percent}%` }} />
    </div>
    <p className="mt-1 text-[11px] tabular-nums text-stone-500">{percent}%</p>
  </div>;
}

/** Small inline label/value pill used in list summaries. */
export function V2Meta({ label, children }: { label: string; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
    <span className="text-stone-400">{label}</span>
    <span className="font-medium text-stone-800">{children}</span>
  </span>;
}

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
  return <header className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

function FeedbackBanner({ message, error }: { message?: string; error?: string }) {
  return <>
    {message && <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</div>}
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
  </>;
}

export function V2ModulePage({ title, description, actions, filters, message, error, children }: {
  title: string; description?: string; actions?: ReactNode; filters?: ReactNode; message?: string; error?: string; children: ReactNode;
}) {
  return <main className="min-h-full px-4 py-6 text-stone-900 md:px-8 md:py-8">
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <ModuleHeader title={title} description={description} actions={actions} />
      <FeedbackBanner message={message} error={error} />
      {filters ? <div className="min-w-0">{filters}</div> : null}
      {children}
    </div>
  </main>;
}

export type V2FilterKeyword = {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  label?: string;
};

/**
 * Compact GET filter bar for V2 list pages.
 *
 * `children` are the common page-specific filters, `more` is the optional
 * additional-filter slot, and `hidden` can carry preserved query state. The
 * component only owns layout: each page keeps its existing field names,
 * defaults and query contract.
 */
export function V2FilterBar({
  action,
  label = "筛选",
  keyword,
  children,
  more,
  moreLabel = "更多筛选",
  submitLabel = "查询",
  resetHref,
  hidden,
  actions,
  className = "",
}: {
  action?: string;
  label?: string;
  keyword?: V2FilterKeyword;
  children?: ReactNode;
  more?: ReactNode;
  moreLabel?: string;
  submitLabel?: string;
  resetHref?: string;
  hidden?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return <form
    method="get"
    action={action}
    aria-label={label}
    className={`min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${className}`}
  >
    {hidden}
    <div className="flex flex-wrap items-end gap-2">
      {keyword ? <label className="block min-w-0 flex-1 basis-56 text-xs text-stone-600">
        <span className="mb-1 block font-medium">{keyword.label ?? "关键词"}</span>
        <input
          className={input}
          name={keyword.name ?? "q"}
          type="search"
          defaultValue={keyword.defaultValue}
          placeholder={keyword.placeholder}
        />
      </label> : null}
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={button}>{submitLabel}</button>
        {actions}
        {resetHref ? <Link
          href={resetHref}
          className="px-2 py-2 text-sm text-stone-500 underline underline-offset-2 transition hover:text-stone-800"
        >
          清除筛选
        </Link> : null}
      </div>
    </div>
    {more ? <details className="mt-2 border-t border-stone-100 pt-2">
      <summary className="cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-800">
        {moreLabel}
      </summary>
      <div className="flex flex-wrap items-end gap-2 pt-2">{more}</div>
    </details> : null}
  </form>;
}

export function V2FilterField({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  return <label className={`block text-xs text-stone-600 ${className}`}>
    <span className="mb-1 block font-medium">{label}</span>
    {children}
  </label>;
}

export { V2_COLUMN_WIDTH, v2ColumnWidth, type V2ColumnField } from "./table-columns";
import { V2_COLUMN_WIDTH, type V2ColumnField } from "./table-columns";

/**
 * Server-rendered table scroll container for the shared V2 table pattern.
 * Pass `fields` in column order to opt in to field-based widths; the generated
 * `<colgroup>` carries a `data-field` marker so the width contract stays
 * inspectable in the browser. The rightmost action column still opts in to
 * sticky styling; nothing here targets every table globally.
 */
export function V2Table({ label, fields, minWidthClass = "min-w-[68rem]", children }: {
  label: string;
  fields?: readonly V2ColumnField[];
  minWidthClass?: string;
  children: ReactNode;
}) {
  return <div
    role="region"
    aria-label={label}
    tabIndex={0}
    className="max-w-full min-w-0 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
  >
    <table className={`w-full border-collapse text-left text-sm ${minWidthClass}`}>
      {fields && fields.length > 0 ? <colgroup>
        {fields.map((field, index) => <col
          key={`${index}-${field}`}
          data-field={field}
          style={{ width: V2_COLUMN_WIDTH[field] }}
        />)}
      </colgroup> : null}
      {children}
    </table>
  </div>;
}

/** Read-only label/value grid used by View drawers and detail panels. */
export function DetailList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-2 ${className}`}>
    {children}
  </dl>;
}

export function DetailItem({ label, children, span = 1 }: {
  label: string; children: ReactNode; span?: 1 | 2;
}) {
  const value = children === null || children === undefined || children === "" ? "—" : children;
  return <div className={`min-w-0 bg-white px-3 py-2.5 ${span === 2 ? "sm:col-span-2" : ""}`}>
    <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</dt>
    <dd className="mt-0.5 break-words text-sm text-stone-900">{value}</dd>
  </div>;
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
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
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
