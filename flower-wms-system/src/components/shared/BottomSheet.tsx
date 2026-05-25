"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
};

export function BottomSheet({ open, onClose, children, title }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 md:hidden"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-zinc-200 bg-white p-5 shadow-2xl md:hidden">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-300" />
        {title ? (
          <h3 className="mb-4 text-lg font-semibold text-zinc-900">{title}</h3>
        ) : null}
        {children}
      </div>
    </>
  );
}
