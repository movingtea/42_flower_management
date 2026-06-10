import Link from "next/link";

type Props = {
  title: string;
  description: string;
  primaryActionLabel?: string;
  primaryActionHref?: string;
  secondaryActionLabel?: string;
  secondaryActionHref?: string;
  className?: string;
};

export function ActionEmptyState({
  title,
  description,
  primaryActionLabel,
  primaryActionHref,
  secondaryActionLabel,
  secondaryActionHref,
  className = "",
}: Props) {
  return (
    <div
      className={`rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-10 text-center shadow-sm ${className}`}
    >
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-500">
        {description}
      </p>
      {(primaryActionHref || secondaryActionHref) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {primaryActionHref && primaryActionLabel ? (
            <Link
              href={primaryActionHref}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              {primaryActionLabel}
            </Link>
          ) : null}
          {secondaryActionHref && secondaryActionLabel ? (
            <Link
              href={secondaryActionHref}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {secondaryActionLabel}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
