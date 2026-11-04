"use client";

import { useState } from "react";

type NumericInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  decimals?: number;
};

export function normalizeNumericText(rawValue: string, decimals = 0) {
  const allowed = decimals > 0 ? rawValue.replace(/[^\d.]/g, "") : rawValue.replace(/\D/g, "");
  if (!allowed) return "";

  if (decimals === 0) return allowed.replace(/^0+(?=\d)/, "");

  const [rawInteger = "", ...fractionParts] = allowed.split(".");
  const integer = (rawInteger || "0").replace(/^0+(?=\d)/, "");
  if (fractionParts.length === 0) return integer;
  return `${integer}.${fractionParts.join("").slice(0, decimals)}`;
}

function clamp(value: number, min?: number, max?: number) {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export function NumericInput({ value, onValueChange, min, max, decimals = 0, onBlur, ...props }: NumericInputProps) {
  const [text, setText] = useState(() => String(value));

  function commit() {
    const parsed = Number(text);
    const fallback = min ?? 0;
    const next = clamp(Number.isFinite(parsed) ? parsed : fallback, min, max);
    const rounded = decimals === 0 ? Math.round(next) : Number(next.toFixed(decimals));
    setText(String(rounded));
    onValueChange(rounded);
  }

  return <input
    {...props}
    type="text"
    inputMode={decimals > 0 ? "decimal" : "numeric"}
    value={text}
    onChange={(event) => {
      const normalized = normalizeNumericText(event.target.value, decimals);
      if (normalized !== "" && normalized !== "." && !normalized.endsWith(".")) {
        const next = clamp(Number(normalized), min, max);
        setText(next === Number(normalized) ? normalized : String(next));
        onValueChange(next);
      } else {
        setText(normalized);
      }
    }}
    onBlur={(event) => { commit(); onBlur?.(event); }}
  />;
}
