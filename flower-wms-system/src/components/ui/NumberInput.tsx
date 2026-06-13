"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  clampNumber,
  formatNumberDraft,
  isValidDecimalDraft,
  isValidIntegerDraft,
  parseDecimalDraft,
  parseIntegerDraft,
} from "@/lib/number-input-utils";

export type NumberInputProps = {
  label?: string;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** blur 时再通知父组件（适合表格内联保存） */
  commitOnBlur?: boolean;
  integerOnly?: boolean;
  allowDecimal?: boolean;
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
  onBlur?: () => void;
};

export function NumberInput({
  label,
  value,
  onChange,
  commitOnBlur = false,
  integerOnly = false,
  allowDecimal,
  allowEmpty = true,
  min,
  max,
  step,
  placeholder,
  disabled,
  required,
  error,
  className = "",
  inputClassName = "",
  id,
  onBlur,
}: NumberInputProps) {
  const autoId = useId();
  const inputId = id ?? (label ? autoId : undefined);
  const decimal = allowDecimal ?? !integerOnly;
  const [draft, setDraft] = useState(() =>
    formatNumberDraft(value, integerOnly)
  );
  const focusedRef = useRef(false);
  const pendingRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(formatNumberDraft(value, integerOnly));
    }
  }, [value, integerOnly]);

  function parseDraft(raw: string): number | null {
    return integerOnly ? parseIntegerDraft(raw) : parseDecimalDraft(raw);
  }

  function isValidDraft(raw: string): boolean {
    return integerOnly ? isValidIntegerDraft(raw) : isValidDecimalDraft(raw);
  }

  function emit(next: number | null) {
    if (commitOnBlur) {
      pendingRef.current = next;
      return;
    }
    onChange(next);
  }

  function commitPending() {
    if (commitOnBlur && pendingRef.current !== undefined) {
      onChange(pendingRef.current);
      pendingRef.current = undefined;
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (!isValidDraft(next)) return;
    setDraft(next);

    if (next === "" || next === "-" || next === ".") {
      emit(null);
      return;
    }

    const parsed = parseDraft(next);
    if (parsed != null) {
      emit(parsed);
    }
  }

  function handleBlur() {
    focusedRef.current = false;
    commitPending();

    const parsed = parseDraft(draft);
    if (parsed == null) {
      if (!allowEmpty && required) {
        setDraft(formatNumberDraft(min ?? 0, integerOnly));
        onChange(min ?? 0);
      }
      onBlur?.();
      return;
    }

    let finalValue = integerOnly ? Math.trunc(parsed) : parsed;
    if (min != null || max != null) {
      finalValue = clampNumber(finalValue, min, max);
    }
    if (integerOnly && decimal) {
      finalValue = Math.trunc(finalValue);
    }

    onChange(finalValue);
    setDraft(formatNumberDraft(finalValue, integerOnly));
    onBlur?.();
  }

  function handleFocus() {
    focusedRef.current = true;
    pendingRef.current = undefined;
  }

  const field = (
    <input
      id={inputId}
      type="text"
      inputMode={integerOnly ? "numeric" : "decimal"}
      value={draft}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      step={step}
      className={`w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${inputClassName}`}
    />
  );

  if (!label) {
    return (
      <div className={className}>
        {field}
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      {field}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </label>
  );
}

/** 字符串金额/数量字段（表单存 string，如 price、"12.5"） */
export type DecimalStringInputProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
};

export function IntegerStringInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  className = "",
  id,
}: DecimalStringInputProps) {
  const autoId = useId();
  const inputId = id ?? (label ? autoId : undefined);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next === "" || isValidIntegerDraft(next)) {
      onChange(next);
    }
  }

  const field = (
    <input
      id={inputId}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
    />
  );

  if (!label) return <div className={className}>{field}</div>;

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      {field}
    </label>
  );
}

export function DecimalStringInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  className = "",
  id,
}: DecimalStringInputProps) {
  const autoId = useId();
  const inputId = id ?? (label ? autoId : undefined);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    if (next === "" || isValidDecimalDraft(next)) {
      onChange(next);
    }
  }

  const field = (
    <input
      id={inputId}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-zinc-900 outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 disabled:bg-zinc-50"
    />
  );

  if (!label) return <div className={className}>{field}</div>;

  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      {field}
    </label>
  );
}
