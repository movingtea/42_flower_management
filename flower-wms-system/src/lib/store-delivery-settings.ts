import type { DeliverySettings } from "@/services/delivery-settings-pure";

export const STORE_DELIVERY_SETTINGS_KEY = "STORE_DELIVERY_SETTINGS";
export const STORE_DELIVERY_SETTINGS_NAME = "店铺配送设置";

/** 订单总数量大批量提示阈值（仅提示，不拒单） */
export const ORDER_TOTAL_QUANTITY_HINT_THRESHOLD = 5;

export type StoreDeliverySettings = {
  sameDayEnabled: boolean;
  sameDayCutoffTime: string;
  deliveryStartTime: string;
  deliveryEndTime: string;
  preorderEnabled: boolean;
  disabledDates: string[];
  dailyOrderLimit: number | null;
};

export function defaultStoreDeliverySettings(): StoreDeliverySettings {
  return {
    sameDayEnabled: true,
    sameDayCutoffTime: "17:00",
    deliveryStartTime: "10:00",
    deliveryEndTime: "20:00",
    preorderEnabled: true,
    disabledDates: [],
    dailyOrderLimit: null,
  };
}

function isHm(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim());
}

export function parseStoreDeliverySettings(
  value: unknown
): StoreDeliverySettings {
  const defaults = defaultStoreDeliverySettings();
  if (!value || typeof value !== "object") return defaults;

  const o = value as Record<string, unknown>;
  const disabledRaw = o.disabledDates;
  const disabledDates = Array.isArray(disabledRaw)
    ? disabledRaw
        .map((d) => (typeof d === "string" ? d.trim() : ""))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : defaults.disabledDates;

  const dailyLimit =
    o.dailyOrderLimit == null || o.dailyOrderLimit === ""
      ? null
      : Number(o.dailyOrderLimit);

  return {
    sameDayEnabled: o.sameDayEnabled !== false,
    sameDayCutoffTime: isHm(o.sameDayCutoffTime)
      ? o.sameDayCutoffTime.trim()
      : defaults.sameDayCutoffTime,
    deliveryStartTime: isHm(o.deliveryStartTime)
      ? o.deliveryStartTime.trim()
      : defaults.deliveryStartTime,
    deliveryEndTime: isHm(o.deliveryEndTime)
      ? o.deliveryEndTime.trim()
      : defaults.deliveryEndTime,
    preorderEnabled: o.preorderEnabled !== false,
    disabledDates,
    dailyOrderLimit:
      dailyLimit != null && Number.isInteger(dailyLimit) && dailyLimit > 0
        ? dailyLimit
        : null,
  };
}

export function validateStoreDeliverySettings(
  input: StoreDeliverySettings
): string | null {
  const timeFields = [
    ["当天截单时间", input.sameDayCutoffTime],
    ["配送开始时间", input.deliveryStartTime],
    ["配送结束时间", input.deliveryEndTime],
  ] as const;

  for (const [label, value] of timeFields) {
    if (!isHm(value)) return `${label}格式应为 HH:mm`;
  }

  const toMinutes = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m;
  };

  if (toMinutes(input.deliveryStartTime) >= toMinutes(input.deliveryEndTime)) {
    return "配送开始时间必须早于结束时间";
  }

  return null;
}

export function toDeliverySettingsInput(
  settings: StoreDeliverySettings
): DeliverySettings {
  return {
    sameDayCutoffTime: settings.sameDayCutoffTime,
    deliveryTimeRange: {
      start: settings.deliveryStartTime,
      end: settings.deliveryEndTime,
    },
    sameDayEnabled: settings.sameDayEnabled,
    preorderEnabled: settings.preorderEnabled,
    disabledDates: settings.disabledDates,
  };
}

/** 小程序配送时段文案 → HH:mm（用于服务端校验） */
export const DELIVERY_TIME_BUCKET_MAP: Record<string, string> = {
  上午: "10:00",
  下午: "14:00",
  傍晚: "18:00",
  晚上: "20:00",
};

export function resolveDeliveryTimeForValidation(
  deliveryDateLabel: string
): string | null {
  const trimmed = deliveryDateLabel.trim();
  const hmMatch = /(\d{1,2}:\d{2})/.exec(trimmed);
  if (hmMatch) return hmMatch[1];

  for (const [bucket, time] of Object.entries(DELIVERY_TIME_BUCKET_MAP)) {
    if (trimmed.includes(bucket)) return time;
  }
  return null;
}
