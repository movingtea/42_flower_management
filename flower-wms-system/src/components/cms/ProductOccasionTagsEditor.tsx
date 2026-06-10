"use client";

import { GIFT_OCCASION_OPTIONS } from "@/lib/crm-tags";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
};

export function ProductOccasionTagsEditor({ value, onChange }: Props) {
  function toggle(key: string) {
    if (value.includes(key)) {
      onChange(value.filter((item) => item !== key));
    } else {
      onChange([...value, key]);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        场景标签用于 CRM 复购提醒和后续商品推荐，不会自动改变商品上下架。
      </p>
      <div className="flex flex-wrap gap-2">
        {GIFT_OCCASION_OPTIONS.map((option) => {
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
