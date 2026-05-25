"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastItem = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
};

let toastId = 0;

export function useToast(durationMs = 3200) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastItem["type"] = "info") => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type }]);
      return id;
    },
    []
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), durationMs)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, dismiss, durationMs]);

  return { toasts, show, dismiss };
}
