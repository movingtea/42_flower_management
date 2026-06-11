/** 小程序下单页配送日期 / 时段约束（与后端 delivery-settings-pure 语义对齐） */

import type { DeliverySettingsResponse } from './delivery-settings-api';

const TIME_BUCKET_HM: Record<string, string> = {
  上午: '10:00',
  下午: '14:00',
  傍晚: '18:00',
  晚上: '20:00',
};

const ALL_BUCKETS = ['上午', '下午', '傍晚', '晚上'];

function parseHmToMinutes(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function getShanghaiClockMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  const nd = new Date(utc);
  const yy = nd.getUTCFullYear();
  const mm = `${nd.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${nd.getUTCDate()}`.padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getTodayShanghaiDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 计算可选配送日期的最小值（bulk 预订 + 店铺设置） */
export function computeMinDeliveryDate(input: {
  settings: DeliverySettingsResponse | null;
  bulkEarliestDate: string | null;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const today = getTodayShanghaiDateString(now);
  let min = input.bulkEarliestDate ?? today;

  const settings = input.settings;
  if (!settings) return min;

  let sameDayMin = today;
  if (!settings.sameDayEnabled) {
    sameDayMin = addDaysToDateString(today, 1);
  } else {
    const cutoff = parseHmToMinutes(settings.sameDayCutoffTime);
    const nowMin = getShanghaiClockMinutes(now);
    if (cutoff != null && nowMin >= cutoff) {
      sameDayMin = addDaysToDateString(today, 1);
    }
  }

  if (min < sameDayMin) min = sameDayMin;
  if (!settings.preorderEnabled && min > today) {
    min = sameDayMin;
  }
  return min;
}

export function isDeliveryDateAllowed(input: {
  date: string;
  settings: DeliverySettingsResponse | null;
  bulkEarliestDate: string | null;
  now?: Date;
}): boolean {
  const min = computeMinDeliveryDate({
    settings: input.settings,
    bulkEarliestDate: input.bulkEarliestDate,
    now: input.now,
  });
  if (input.date < min) return false;
  if (input.settings?.disabledDates?.includes(input.date)) return false;
  return true;
}

/** 根据店铺配送时段过滤可选时段文案 */
export function filterDeliveryTimeBuckets(
  settings: DeliverySettingsResponse | null
): string[] {
  if (!settings) return ALL_BUCKETS;

  const start = parseHmToMinutes(settings.deliveryStartTime);
  const end = parseHmToMinutes(settings.deliveryEndTime);
  if (start == null || end == null) return ALL_BUCKETS;

  return ALL_BUCKETS.filter((bucket) => {
    const hm = TIME_BUCKET_HM[bucket];
    const minutes = parseHmToMinutes(hm);
    if (minutes == null) return false;
    return minutes >= start && minutes <= end;
  });
}

export const ORDER_TOTAL_QUANTITY_HINT_THRESHOLD = 5;

export function shouldShowLargeOrderHint(totalQuantity: number): boolean {
  return totalQuantity >= ORDER_TOTAL_QUANTITY_HINT_THRESHOLD;
}
