import { formatCurrency, formatPercent, safeDecimalToNumber } from "@/lib/format-money";

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = safeDecimalToNumber(value);
  if (Number.isInteger(number)) {
    return new Intl.NumberFormat("zh-CN").format(number);
  }
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(number);
}

export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatNullable<T>(
  value: T | null | undefined,
  formatter: (input: T) => string
): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatter(value);
}

export function formatSignedCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = safeDecimalToNumber(value);
  const formatted = formatCurrency(Math.abs(number));
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}

export function formatSignedPercent(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = safeDecimalToNumber(value);
  const formatted = formatPercent(Math.abs(number));
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}
