import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  requiredMark?: boolean;
}

export function Input({
  label,
  requiredMark = false,
  className = "",
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.replace(/\s/g, "-").toLowerCase();
  return (
    <label className="block text-sm">
      {label && (
        <span className="mb-1 block font-medium text-zinc-700">
          {label}
          {requiredMark ? <span className="ml-1 text-red-500">*</span> : null}
        </span>
      )}
      <input
        id={inputId}
        className={`w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 ${className}`}
        {...props}
      />
    </label>
  );
}
