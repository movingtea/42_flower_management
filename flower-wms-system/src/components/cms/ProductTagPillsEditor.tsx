"use client";

import type { CmsProductTagOption } from "@/lib/cms-product-tags";

type Props = {
  label?: string;
  hint?: string;
  options: CmsProductTagOption[];
  value: string[];
  onChange: (next: string[]) => void;
  singleSelect?: boolean;
};

export function ProductTagPillsEditor({
  label,
  hint,
  options,
  value,
  onChange,
  singleSelect = false,
}: Props) {
  function toggle(key: string) {
    if (singleSelect) {
      onChange(value.includes(key) ? [] : [key]);
      return;
    }
    if (value.includes(key)) {
      onChange(value.filter((item) => item !== key));
    } else {
      onChange([...value, key]);
    }
  }

  return (
    <div className="space-y-2">
      {label ? (
        <p className="text-sm font-medium text-zinc-800">{label}</p>
      ) : null}
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => toggle(option.key)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
