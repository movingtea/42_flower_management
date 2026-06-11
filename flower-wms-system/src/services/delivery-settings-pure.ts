import {
  APP_TIME_ZONE,
  getTodayAppDateString,
  parseAppDateString,
} from "@/lib/datetime";
import { MINIPROGRAM_ERROR_CODES } from "@/lib/miniprogram-business-error";

export const DEFAULT_SAME_DAY_CUTOFF = "17:00";
export const DEFAULT_DELIVERY_TIME_START = "10:00";
export const DEFAULT_DELIVERY_TIME_END = "20:00";

export type DeliveryTimeRange = {
  start: string;
  end: string;
};

export type DeliverySettings = {
  sameDayCutoffTime?: string;
  deliveryTimeRange?: DeliveryTimeRange;
  sameDayEnabled?: boolean;
  preorderEnabled?: boolean;
  disabledDates?: string[];
};

export type EvaluateDeliveryAvailabilityInput = {
  deliveryDate: string;
  deliveryTime?: string | null;
  now?: Date;
  timezone?: string;
  settings?: DeliverySettings;
};

export type DeliveryAvailabilityReason = {
  code: string;
  message: string;
};

export type EvaluateDeliveryAvailabilityResult = {
  allowed: boolean;
  code?: string;
  message?: string;
  reasons: DeliveryAvailabilityReason[];
};

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function extractDatePart(deliveryDate: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(deliveryDate.trim());
  if (!match) return null;
  return parseAppDateString(match[1]) ? match[1] : null;
}

const DELIVERY_TIME_BUCKET_MAP: Record<string, string> = {
  上午: "10:00",
  下午: "14:00",
  傍晚: "18:00",
  晚上: "20:00",
};

function extractTimePart(
  deliveryDate: string,
  explicitTime?: string | null
): string | null {
  if (explicitTime?.trim()) return explicitTime.trim();
  const match = /(\d{1,2}:\d{2})/.exec(deliveryDate);
  if (match) return match[1];
  for (const [bucket, time] of Object.entries(DELIVERY_TIME_BUCKET_MAP)) {
    if (deliveryDate.includes(bucket)) return time;
  }
  return null;
}

function compareAppDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function getAppClockMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

function resolveSettings(settings?: DeliverySettings) {
  return {
    sameDayCutoffTime: settings?.sameDayCutoffTime ?? DEFAULT_SAME_DAY_CUTOFF,
    deliveryTimeRange: settings?.deliveryTimeRange ?? {
      start: DEFAULT_DELIVERY_TIME_START,
      end: DEFAULT_DELIVERY_TIME_END,
    },
    sameDayEnabled: settings?.sameDayEnabled !== false,
    preorderEnabled: settings?.preorderEnabled !== false,
    disabledDates: settings?.disabledDates ?? [],
  };
}

/**
 * 评估配送日期 / 时段是否可选（Asia/Shanghai 业务日）。
 */
export function evaluateDeliveryAvailability(
  input: EvaluateDeliveryAvailabilityInput
): EvaluateDeliveryAvailabilityResult {
  const now = input.now ?? new Date();
  const settings = resolveSettings(input.settings);
  const reasons: DeliveryAvailabilityReason[] = [];

  const datePart = extractDatePart(input.deliveryDate);
  if (!datePart) {
    return {
      allowed: false,
      code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
      message: "请选择有效配送日期",
      reasons: [
        {
          code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
          message: "配送日期格式无效",
        },
      ],
    };
  }

  const today = getTodayAppDateString(now);
  const isToday = datePart === today;
  const isPast = compareAppDates(datePart, today) < 0;

  if (isPast) {
    reasons.push({
      code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
      message: "不能选择过去的配送日期",
    });
  }

  if (settings.disabledDates.includes(datePart)) {
    reasons.push({
      code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
      message: "该日期暂不支持配送",
    });
  }

  if (isToday && !settings.sameDayEnabled) {
    reasons.push({
      code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
      message: "店铺暂未开启当天配送",
    });
  }

  if (isToday && settings.sameDayEnabled) {
    const nowMinutes = getAppClockMinutes(now);
    const cutoffMinutes = parseTimeToMinutes(settings.sameDayCutoffTime);
    if (cutoffMinutes != null && nowMinutes >= cutoffMinutes) {
      reasons.push({
        code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
        message: `当天配送已于 ${settings.sameDayCutoffTime} 截单`,
      });
    }
  }

  if (!isToday && !settings.preorderEnabled) {
    reasons.push({
      code: MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
      message: "店铺暂未开启预约配送",
    });
  }

  const timePart = extractTimePart(input.deliveryDate, input.deliveryTime);
  if (timePart) {
    const selectedMinutes = parseTimeToMinutes(timePart);
    const startMinutes = parseTimeToMinutes(settings.deliveryTimeRange.start);
    const endMinutes = parseTimeToMinutes(settings.deliveryTimeRange.end);

    if (
      selectedMinutes == null ||
      startMinutes == null ||
      endMinutes == null ||
      selectedMinutes < startMinutes ||
      selectedMinutes > endMinutes
    ) {
      reasons.push({
        code: MINIPROGRAM_ERROR_CODES.DELIVERY_SLOT_UNAVAILABLE,
        message: `配送时段需在 ${settings.deliveryTimeRange.start}-${settings.deliveryTimeRange.end} 之间`,
      });
    }
  }

  if (reasons.length > 0) {
    const primary = reasons[0];
    return {
      allowed: false,
      code: primary.code,
      message: primary.message,
      reasons,
    };
  }

  return { allowed: true, reasons: [] };
}
