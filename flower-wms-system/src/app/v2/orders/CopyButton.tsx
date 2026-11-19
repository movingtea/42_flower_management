"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  value: string;
  label: string;
  className?: string;
};

/**
 * Client-side clipboard button. Callers must only render it when the source value is
 * non-empty (`hasCopyValue`), so an absent phone/address never produces a dead control.
 */
export function CopyButton({ value, label, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? `已复制${label}` : `复制${label}`}
      title={copied ? "已复制" : `复制${label}`}
      onClick={(event) => void handleCopy(event)}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600 ${className}`}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.25} aria-hidden />
      ) : (
        <Copy className="size-3.5" strokeWidth={2.25} aria-hidden />
      )}
    </button>
  );
}
