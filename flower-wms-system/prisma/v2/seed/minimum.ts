import { LocationKind } from "../../../src/generated/prisma-v2/client";
import type { SeedBaseline, SeedTransaction } from "./types";

/**
 * `minimum` tier: the tenant/store/locations/settings baseline.
 *
 * This is the data `db:v2:seed:test` has always created. Upserts keep it
 * idempotent and preserve any store configuration edited later.
 */

export const DEFAULT_TENANT_SLUG = "default";
export const DEFAULT_TENANT_NAME = "默认花店";
export const DEFAULT_STORE_CODE = "MAIN";
export const DEFAULT_STORE_NAME = "主店";
export const STOCK_LOCATION_CODE = "STOCK";
export const PRODUCTION_LOCATION_CODE = "PRODUCTION";

export async function applyMinimum(db: SeedTransaction): Promise<SeedBaseline> {
  const tenant = await db.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    create: { slug: DEFAULT_TENANT_SLUG, name: DEFAULT_TENANT_NAME },
    update: {},
  });
  const store = await db.store.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: DEFAULT_STORE_CODE } },
    create: {
      tenantId: tenant.id,
      code: DEFAULT_STORE_CODE,
      name: DEFAULT_STORE_NAME,
    },
    update: {},
  });
  const stock = await db.inventoryLocation.upsert({
    where: { storeId_code: { storeId: store.id, code: STOCK_LOCATION_CODE } },
    create: {
      storeId: store.id,
      code: STOCK_LOCATION_CODE,
      kind: LocationKind.WAREHOUSE,
    },
    update: {},
  });
  const production = await db.inventoryLocation.upsert({
    where: {
      storeId_code: { storeId: store.id, code: PRODUCTION_LOCATION_CODE },
    },
    create: {
      storeId: store.id,
      code: PRODUCTION_LOCATION_CODE,
      kind: LocationKind.PRODUCTION,
    },
    update: {},
  });
  await db.storeSettings.upsert({
    where: { storeId: store.id },
    create: {
      tenantId: tenant.id,
      storeId: store.id,
      deliveryConfig: {},
      capacityConfig: {},
    },
    update: {},
  });

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    storeId: store.id,
    storeCode: store.code,
    stockLocationId: stock.id,
    stockLocationCode: stock.code,
    productionLocationId: production.id,
    productionLocationCode: production.code,
  };
}
