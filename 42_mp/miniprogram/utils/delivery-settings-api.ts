import { request } from './request';

export type DeliverySettingsResponse = {
  sameDayEnabled: boolean;
  sameDayCutoffTime: string;
  deliveryStartTime: string;
  deliveryEndTime: string;
  preorderEnabled: boolean;
  disabledDates: string[];
  dailyOrderLimit: number | null;
  deliveryTimeRange: { start: string; end: string };
};

export function fetchDeliverySettings() {
  return request<DeliverySettingsResponse>({
    url: '/delivery-settings',
    method: 'GET',
    quiet: true,
  });
}
