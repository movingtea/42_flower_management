"use client";

type Props = {
  value: number;
  min?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function QuantityStepper({
  value,
  min = 1,
  onChange,
  disabled,
}: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center text-lg font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        aria-label="减少"
      >
        −
      </button>
      <span className="min-w-[2.5rem] text-center text-base font-semibold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center text-lg font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        aria-label="增加"
      >
        +
      </button>
    </div>
  );
}
