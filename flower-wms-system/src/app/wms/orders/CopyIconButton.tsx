"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  text: string;
  label: string;
  className?: string;
};

export function CopyIconButton({ text, label, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(text);
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
      onClick={(e) => void handleCopy(e)}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-500 ${className}`}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.25} aria-hidden />
      ) : (
        <Copy className="size-3.5" strokeWidth={2.25} aria-hidden />
      )}
    </button>
  );
}
