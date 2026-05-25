"use client";

import { useState } from "react";

type Props = {
  label: string;
  englishName: string;
  maintenance: string | null;
};

export function WikiHoverCard({ label, englishName, maintenance }: Props) {
  const [open, setOpen] = useState(false);

  if (!maintenance) {
    return <span className="text-zinc-700">{label}</span>;
  }

  return (
    <span
      className="relative inline-block cursor-help border-b border-dashed border-rose-300 text-rose-800"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {label}
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-950 shadow-lg"
        >
          <span className="mb-1 block font-semibold text-rose-900">
            {label} · {englishName}
          </span>
          <span className="block whitespace-pre-wrap">{maintenance}</span>
        </span>
      )}
    </span>
  );
}
