export const APP_TIME_ZONE = "Asia/Shanghai";

const APP_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AppCalendarParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

export function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseAppDateString(value: string): Pick<AppCalendarParts, "year" | "month" | "day"> | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function getAppCalendarParts(date: Date): AppCalendarParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

export function appDateStringFromParts(
  parts: Pick<AppCalendarParts, "year" | "month" | "day">
): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getTodayAppDateString(now: Date = new Date()): string {
  return appDateStringFromParts(getAppCalendarParts(now));
}

function shanghaiMidnightUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - APP_TIME_ZONE_OFFSET_MS;
}

export function addAppCalendarDays(
  parts: Pick<AppCalendarParts, "year" | "month" | "day">,
  days: number
): Pick<AppCalendarParts, "year" | "month" | "day"> {
  const nextMs = shanghaiMidnightUtcMs(parts.year, parts.month, parts.day) + days * MS_PER_DAY;
  return getAppCalendarParts(new Date(nextMs));
}

export function getAppDayRangeUtc(dateString: string): {
  startUtc: Date;
  endUtcExclusive: Date;
} {
  const parsed = parseAppDateString(dateString);
  if (!parsed) {
    throw new Error(`日期格式应为 YYYY-MM-DD：${dateString}`);
  }
  const startMs = shanghaiMidnightUtcMs(parsed.year, parsed.month, parsed.day);
  return {
    startUtc: new Date(startMs),
    endUtcExclusive: new Date(startMs + MS_PER_DAY),
  };
}

export function getAppDateRangeUtc(
  startDate?: string | null,
  endDate?: string | null
): {
  startUtc: Date | undefined;
  endUtcExclusive: Date | undefined;
} {
  let startUtc: Date | undefined;
  let endUtcExclusive: Date | undefined;

  if (startDate) {
    const parsed = parseAppDateString(startDate);
    if (!parsed) {
      throw new Error(`开始日期格式应为 YYYY-MM-DD：${startDate}`);
    }
    startUtc = getAppDayRangeUtc(startDate).startUtc;
  }

  if (endDate) {
    const parsed = parseAppDateString(endDate);
    if (!parsed) {
      throw new Error(`结束日期格式应为 YYYY-MM-DD：${endDate}`);
    }
    endUtcExclusive = getAppDayRangeUtc(endDate).endUtcExclusive;
  } else if (startDate) {
    endUtcExclusive = getAppDayRangeUtc(startDate).endUtcExclusive;
  }

  return { startUtc, endUtcExclusive };
}

function formatWithAppTimezone(
  value: unknown,
  options: Intl.DateTimeFormatOptions
): string {
  const date = coerceDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(date);
}

function formatDateTimeParts(
  value: unknown,
  withSeconds: boolean
): string {
  const date = coerceDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const base = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  return withSeconds ? `${base}:${get("second")}` : base;
}

export function formatDateInAppTimezone(value: unknown): string {
  return formatWithAppTimezone(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "-");
}

export function formatDateInAppTimezoneIso(value: unknown): string {
  const date = coerceDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTimeInAppTimezone(value: unknown): string {
  return formatDateTimeParts(value, false);
}

export function formatDateTimeWithSecondsInAppTimezone(value: unknown): string {
  return formatDateTimeParts(value, true);
}

export function formatNullableDate(value: unknown): string {
  const formatted = formatDateInAppTimezoneIso(value);
  return formatted || "—";
}

export function formatNullableDateTime(value: unknown): string {
  const formatted = formatDateTimeInAppTimezone(value);
  return formatted || "—";
}

export function getAppDateKey(value: unknown): string {
  return formatDateInAppTimezoneIso(value);
}

export function listAppDateKeysInRange(startUtc: Date, endUtcExclusive: Date): string[] {
  const keys: string[] = [];
  for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += MS_PER_DAY) {
    keys.push(getAppDateKey(new Date(ms)));
  }
  return keys;
}

export function normalizeReportDateParam(
  value: string | Date | null | undefined,
  fallbackNow: Date = new Date()
): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = parseAppDateString(value);
    if (!parsed) {
      throw new Error(`日期格式应为 YYYY-MM-DD：${value}`);
    }
    return value.trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateInAppTimezoneIso(value);
  }
  return getTodayAppDateString(fallbackNow);
}

export function serializeReportDateRange(range: {
  startDate: Date;
  endDate: Date;
  label: string;
}): {
  startDate: string;
  endDate: string;
  label: string;
} {
  const endInclusive = new Date(range.endDate.getTime() - 1);
  return {
    startDate: formatDateInAppTimezoneIso(range.startDate),
    endDate: formatDateInAppTimezoneIso(endInclusive),
    label: range.label,
  };
}
