import { jsonError } from "@/lib/api";
import { toDeliverySettingsInput } from "@/lib/store-delivery-settings";
import { jsonWechatSuccess } from "@/lib/wechat-api";
import { getStoreDeliverySettings } from "@/services/store-delivery-settings";

export const dynamic = "force-dynamic";

/** GET：小程序读取店铺配送设置（只读） */
export async function GET() {
  try {
    const settings = await getStoreDeliverySettings();
    return jsonWechatSuccess({
      ...settings,
      deliveryTimeRange: {
        start: settings.deliveryStartTime,
        end: settings.deliveryEndTime,
      },
      deliverySettings: toDeliverySettingsInput(settings),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "获取配送设置失败";
    return jsonError(message, 500);
  }
}
