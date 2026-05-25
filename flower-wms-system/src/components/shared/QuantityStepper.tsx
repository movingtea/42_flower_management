"use client";

import { useEffect, useState } from "react";

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

function clampValue(value: number, min: number, max?: number): number {
  let next = Math.max(min, Math.round(value));
  if (max !== undefined && Number.isFinite(max)) {
    next = Math.min(max, next);
  }
  return next;
}

export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  disabled,
  className = "",
  "aria-label": ariaLabel = "数量",
}: Props) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commitDraft(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === ".") {
      onChange(min);
      setDraft(String(min));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      onChange(min);
      setDraft(String(min));
      return;
    }
    const next = clampValue(parsed, min, max);
    onChange(next);
    setDraft(String(next));
  }

  function handleBlur() {
    commitDraft(draft);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setDraft(next);
    const parsed = Number(next.trim());
    if (next.trim() !== "" && Number.isFinite(parsed)) {
      onChange(clampValue(parsed, min, max));
    }
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white ${className}`}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clampValue(value - 1, min, max))}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-lg font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        aria-label="减少"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        value={draft}
        onChange={handleInputChange}
        onBlur={handleBlur}
        aria-label={ariaLabel}
        className="h-11 w-14 min-w-[3rem] border-0 bg-transparent text-center text-base font-semibold tabular-nums text-zinc-900 outline-none focus:ring-0 disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-auto [&::-webkit-outer-spin-button]:appearance-auto"
      />
      <button
        type="button"
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(clampValue(value + 1, min, max))}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-lg font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        aria-label="增加"
      >
        +
      </button>
    </div>
  );
}
