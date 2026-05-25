"use client";

import type { ToastItem } from "@/hooks/useToast";

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
};

export function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm shadow-lg backdrop-blur-sm ${
            t.type === "error"
              ? "border border-rose-200 bg-rose-50 text-rose-900"
              : t.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border border-zinc-200 bg-white/95 text-zinc-800"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p>{t.message}</p>
            <button
              type="button"
              className="shrink-0 text-xs opacity-60 hover:opacity-100"
              onClick={() => onDismiss(t.id)}
            >
              关闭
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
