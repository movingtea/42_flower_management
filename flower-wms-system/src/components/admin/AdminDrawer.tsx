"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type AdminDrawerSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZE_CLASS: Record<AdminDrawerSize, string> = {
  sm: "max-w-[360px]",
  md: "max-w-[480px]",
  lg: "max-w-[640px]",
  xl: "max-w-[760px]",
  full: "max-w-[min(960px,100vw)]",
};

export type AdminDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: AdminDrawerSize;
  loading?: boolean;
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

export function AdminDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "lg",
  loading = false,
  closeOnOverlayClick = false,
  showCloseButton = true,
  className = "",
  bodyClassName = "",
  footerClassName = "",
}: AdminDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  function handleClose() {
    onOpenChange(false);
  }

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <div
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
        aria-hidden
        onClick={closeOnOverlayClick ? handleClose : undefined}
      />

      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        className={`absolute inset-y-0 right-0 flex h-dvh w-full flex-col border-l border-zinc-200 bg-white shadow-xl outline-none ${SIZE_CLASS[size]} ${className}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-base font-semibold text-zinc-900 sm:text-lg"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              aria-label="关闭"
              onClick={handleClose}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="size-4" strokeWidth={2.25} aria-hidden />
            </button>
          ) : null}
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${bodyClassName}`}
        >
          {children}
        </div>

        {footer ? (
          <footer
            className={`shrink-0 border-t border-zinc-200 bg-white px-5 py-3 ${footerClassName}`}
          >
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body
  );
}
