"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";

/**
 * Right-side drawer form used by every V2 create/edit entry.
 *
 * The drawer mirrors the V1 admin pattern: full-height panel sliding in from the
 * right, fixed footer with cancel/submit, overlay and Escape to close, body
 * scroll lock and focus restoration. Server-rendered form fields are passed as
 * children; the server action itself is passed as a prop, so the drawer never
 * duplicates business logic.
 */

const SIZE_CLASS = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[680px]",
  xl: "max-w-[820px]",
} as const;

export type V2DrawerSize = keyof typeof SIZE_CLASS;

export type V2DrawerFormProps = {
  triggerLabel: string;
  title: string;
  description?: string;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  size?: V2DrawerSize;
  /** Styling for the trigger button; defaults to the secondary V2 button. */
  triggerClassName?: string;
  /** Optional hint shown on the left side of the footer. */
  footerNote?: string;
  children: ReactNode;
};

const TRIGGER_BASE =
  "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50";
const CANCEL_BASE =
  "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50";
const SUBMIT_BASE =
  "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={SUBMIT_BASE} disabled={pending}>
      {pending ? "保存中…" : label}
    </button>
  );
}

export function V2DrawerForm({
  triggerLabel,
  title,
  description,
  action,
  submitLabel = "保存",
  size = "lg",
  triggerClassName,
  footerNote,
  children,
}: V2DrawerFormProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  // Server actions finish with `redirect("?message=…" | "?error=…")`. The client
  // component survives that navigation, so close the drawer when the query
  // string changes instead of leaving a stale panel open after a save.
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const previousSearchKey = useRef(searchKey);
  useEffect(() => {
    if (previousSearchKey.current === searchKey) return;
    previousSearchKey.current = searchKey;
    setOpen(false);
  }, [searchKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className={triggerClassName ?? TRIGGER_BASE}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {triggerLabel}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50">
              <div
                className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
                aria-hidden
                onClick={close}
              />
              <aside
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className={`absolute inset-y-0 right-0 flex h-dvh w-full flex-col border-l border-zinc-200 bg-white shadow-xl outline-none ${SIZE_CLASS[size]}`}
              >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <h2 id={titleId} className="text-base font-semibold text-zinc-900 sm:text-lg">
                      {title}
                    </h2>
                    {description ? (
                      <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label="关闭"
                    onClick={close}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    ×
                  </button>
                </header>

                <form action={action} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    {children}
                  </div>
                  <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-white px-5 py-3">
                    <p className="min-w-0 text-xs text-zinc-500">{footerNote ?? ""}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" className={CANCEL_BASE} onClick={close}>
                        取消
                      </button>
                      <SubmitButton label={submitLabel} />
                    </div>
                  </footer>
                </form>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
