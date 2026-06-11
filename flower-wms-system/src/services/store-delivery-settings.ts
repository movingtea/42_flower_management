import {
  defaultStoreDeliverySettings,
  parseStoreDeliverySettings,
  STORE_DELIVERY_SETTINGS_KEY,
  STORE_DELIVERY_SETTINGS_NAME,
  type StoreDeliverySettings,
} from "@/lib/store-delivery-settings";
import { prisma } from "@/lib/prisma";

export async function getStoreDeliverySettings(): Promise<StoreDeliverySettings> {
  const row = await prisma.appConfig.findUnique({
    where: { key: STORE_DELIVERY_SETTINGS_KEY },
  });
  if (!row) return defaultStoreDeliverySettings();
  return parseStoreDeliverySettings(row.value);
}

export async function saveStoreDeliverySettings(
  settings: StoreDeliverySettings
): Promise<StoreDeliverySettings> {
  const value = settings;
  await prisma.appConfig.upsert({
    where: { key: STORE_DELIVERY_SETTINGS_KEY },
    create: {
      key: STORE_DELIVERY_SETTINGS_KEY,
      name: STORE_DELIVERY_SETTINGS_NAME,
      value,
    },
    update: {
      name: STORE_DELIVERY_SETTINGS_NAME,
      value,
    },
  });
  return settings;
}
