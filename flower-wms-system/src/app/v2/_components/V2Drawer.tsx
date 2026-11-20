"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  isV2ControlFlowError,
  v2ActionErrorMessage,
  type V2ActionResult,
} from "../_lib/action-result";

/**
 * Right-side drawer used by V2 create/edit entries and read-only views.
 *
 * Behaviour that must stay stable across both modes:
 * - full-height panel sliding in from the right, overlay click and Escape close;
 * - body scroll lock while open, focus moves into the panel, Tab stays inside,
 *   and focus returns to the trigger on close;
 * - `role="dialog"`, `aria-modal` and `aria-labelledby`/`aria-describedby`.
 *
 * `V2DrawerForm` adds submission state on top: it closes only when the current
 * action returns an explicit success result, keeps failures open with the
 * user's input intact, and shows a success notice after `router.refresh()`.
 * `V2Drawer` is the read-only variant with a fixed close footer.
 */

const SIZE_CLASS = {
  sm: "max-w-[420px]",
  md: "max-w-[560px]",
  lg: "max-w-[680px]",
  xl: "max-w-[820px]",
} as const;

export type V2DrawerSize = keyof typeof SIZE_CLASS;

const TRIGGER_BASE =
  "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const CANCEL_BASE =
  "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const SUBMIT_BASE =
  "inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** Shared dialog mechanics for both drawer modes. */
function useDrawerBehavior(open: boolean, requestClose: () => void): {
  panelRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  titleId: string;
  descriptionId: string;
} {
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : triggerRef.current;
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

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
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = visibleFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || active === panel || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  return { panelRef, triggerRef, titleId, descriptionId };
}

function DrawerShell({
  open,
  onClose,
  panelRef,
  titleId,
  descriptionId,
  title,
  description,
  size,
  pending = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  titleId: string;
  descriptionId: string;
  title: string;
  description?: string;
  size: V2DrawerSize;
  pending?: boolean;
  children: ReactNode;
}) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
        aria-hidden
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`absolute inset-y-0 right-0 flex h-dvh w-full flex-col border-l border-stone-200 bg-white shadow-xl outline-none ${SIZE_CLASS[size]}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-stone-900 sm:text-lg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-sm text-stone-500">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={pending}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ×
          </button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

export type V2DrawerProps = {
  triggerLabel: string;
  title: string;
  description?: string;
  size?: V2DrawerSize;
  /** Accessible name for icon/short triggers, e.g. "查看 玫瑰". */
  triggerAriaLabel?: string;
  /** Styling for the trigger button; defaults to the secondary V2 button. */
  triggerClassName?: string;
  footerNote?: string;
  /** Replaces the default close button in the fixed footer. */
  footer?: ReactNode;
  children: ReactNode;
};

export function V2Drawer({
  triggerLabel,
  title,
  description,
  size = "lg",
  triggerAriaLabel,
  triggerClassName,
  footerNote,
  footer,
  children,
}: V2DrawerProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { panelRef, triggerRef, titleId, descriptionId } = useDrawerBehavior(open, close);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? TRIGGER_BASE}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
      >
        {triggerLabel}
      </button>
      <DrawerShell
        open={open}
        onClose={close}
        panelRef={panelRef}
        titleId={titleId}
        descriptionId={descriptionId}
        title={title}
        description={description}
        size={size}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-3">
          <p className="min-w-0 text-xs text-stone-500">{footerNote ?? ""}</p>
          {footer ?? (
            <button type="button" className={CANCEL_BASE} onClick={close}>
              关闭
            </button>
          )}
        </footer>
      </DrawerShell>
    </>
  );
}

export type V2DrawerFormProps = {
  triggerLabel: string;
  title: string;
  description?: string;
  action: (formData: FormData) => Promise<V2ActionResult>;
  submitLabel?: string;
  size?: V2DrawerSize;
  triggerAriaLabel?: string;
  /** Styling for the trigger button; defaults to the secondary V2 button. */
  triggerClassName?: string;
  /** Optional hint shown on the left side of the footer. */
  footerNote?: string;
  children: ReactNode;
};

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
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
  triggerAriaLabel,
  triggerClassName,
  footerNote,
  children,
}: V2DrawerFormProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const router = useRouter();

  const requestClose = useCallback(() => {
    if (pending) return;
    setOpen(false);
    setError(null);
  }, [pending]);

  const { panelRef, triggerRef, titleId, descriptionId } = useDrawerBehavior(open, requestClose);

  const openDrawer = () => {
    setError(null);
    setSuccessMessage(null);
    setOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result.ok) {
          // Only this submission's explicit success closes the panel. Close
          // first so the refreshed list is visible behind the success notice.
          setOpen(false);
          setSuccessMessage(result.message);
          router.refresh();
          return;
        }
        setError(result.error);
      } catch (cause) {
        // Redirect/not-found control flow navigates on its own; anything else
        // (for example a dropped connection) stays inside the open drawer.
        if (isV2ControlFlowError(cause)) return;
        setError(v2ActionErrorMessage(cause));
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? TRIGGER_BASE}
        onClick={openDrawer}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
      >
        {triggerLabel}
      </button>
      {successMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 shadow-lg"
        >
          <p className="min-w-0 flex-1">{successMessage}</p>
          <button
            type="button"
            aria-label="关闭成功提示"
            className="shrink-0 text-base leading-none text-emerald-800 hover:text-emerald-950"
            onClick={() => setSuccessMessage(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <DrawerShell
        open={open}
        onClose={requestClose}
        panelRef={panelRef}
        titleId={titleId}
        descriptionId={descriptionId}
        title={title}
        description={description}
        size={size}
        pending={pending}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"
              >
                {error}
              </div>
            ) : null}
            {children}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 py-3">
            <p className="min-w-0 text-xs text-stone-500">{footerNote ?? ""}</p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className={CANCEL_BASE}
                onClick={requestClose}
                disabled={pending}
              >
                取消
              </button>
              <SubmitButton label={submitLabel} pending={pending} />
            </div>
          </footer>
        </form>
      </DrawerShell>
    </>
  );
}
