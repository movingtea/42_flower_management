import { formatCurrency, formatPercent, safeDecimalToNumber } from "@/lib/format-money";
import {
  formatDateInAppTimezoneIso,
  formatNullableDate,
  formatNullableDateTime,
} from "@/lib/datetime";

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
  return formatNullableDate(value);
}

export function formatDateTime(value: unknown): string {
  return formatNullableDateTime(value);
}

export function formatDateIso(value: unknown): string {
  const formatted = formatDateInAppTimezoneIso(value);
  return formatted || "—";
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
