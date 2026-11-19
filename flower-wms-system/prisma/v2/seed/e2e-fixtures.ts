import { LocationKind } from "../../../src/generated/prisma-v2/client";
import {
  applyStaffAccount,
  type HashedSeedAccount,
  type SeedAccount,
} from "./accounts";
import type { P1ScenarioRefs } from "./p1-scenarios";
import type { SeedBaseline, SeedTransaction } from "./types";

/**
 * `e2e-fixtures` tier: an isolated store, locations, settings and synthetic
 * staff accounts for E1.5 Playwright runs. It always includes `p1-scenarios`
 * reference data (enforced by the tier dependency graph in ./contract).
 *
 * Reset semantics = a freshly migrated database with the tier applied again.
 * The fixtures are upserted, so applying the tier twice never duplicates rows.
 */

export const E2E_TENANT_SLUG = "default";
export const E2E_STORE_CODE = "E2E";
export const E2E_STORE_NAME = "E2E 隔离测试门店";
export const E2E_STOCK_LOCATION_CODE = "E2E-STOCK";
export const E2E_PRODUCTION_LOCATION_CODE = "E2E-PRODUCTION";

/**
 * Synthetic Playwright credential. It is only ever written to a locally
 * migrated throw-away test database; production bootstrap never uses it.
 */
export const E2E_STAFF_PASSWORD = "e2e-only-password";

export const E2E_STAFF: readonly SeedAccount[] = [
  {
    username: "e2e-admin",
    password: E2E_STAFF_PASSWORD,
    displayName: "E2E 管理员",
    roles: ["ADMIN"],
  },
  {
    username: "e2e-manager",
    password: E2E_STAFF_PASSWORD,
    displayName: "E2E 门店经理",
    roles: ["MANAGER"],
  },
  {
    username: "e2e-buyer",
    password: E2E_STAFF_PASSWORD,
    displayName: "E2E 采购人员",
    roles: ["BUYER"],
  },
  {
    username: "e2e-sales",
    password: E2E_STAFF_PASSWORD,
    displayName: "E2E 订单履约人员",
    roles: ["SALES"],
  },
  {
    username: "e2e-florist",
    password: E2E_STAFF_PASSWORD,
    displayName: "E2E 花艺师",
    roles: ["FLORIST"],
  },
] as const;

export const E2E_BATCH_CODES = {
  flower: "E2E-BATCH-ROSE-001",
  consumable: "E2E-BATCH-WRAP-001",
} as const;
export const E2E_BATCH_ON_HAND_QTY = { flower: 55, consumable: 40 } as const;
export const E2E_BATCH_UNIT_COST = 2.5;
export const E2E_BATCH_RECEIVED_AT = new Date("2026-01-02T00:00:00.000Z");

export type E2EFixtureRefs = {
  storeId: string;
  stockLocationId: string;
  productionLocationId: string;
};

export async function applyE2EFixtures(
  db: SeedTransaction,
  baseline: SeedBaseline,
  p1: P1ScenarioRefs,
  accounts: readonly HashedSeedAccount[],
): Promise<E2EFixtureRefs> {
  const store = await db.store.upsert({
    where: {
      tenantId_code: { tenantId: baseline.tenantId, code: E2E_STORE_CODE },
    },
    create: {
      tenantId: baseline.tenantId,
      code: E2E_STORE_CODE,
      name: E2E_STORE_NAME,
    },
    update: { name: E2E_STORE_NAME },
  });
  const stock = await db.inventoryLocation.upsert({
    where: {
      storeId_code: { storeId: store.id, code: E2E_STOCK_LOCATION_CODE },
    },
    create: {
      storeId: store.id,
      code: E2E_STOCK_LOCATION_CODE,
      kind: LocationKind.WAREHOUSE,
    },
    update: { kind: LocationKind.WAREHOUSE },
  });
  const production = await db.inventoryLocation.upsert({
    where: {
      storeId_code: { storeId: store.id, code: E2E_PRODUCTION_LOCATION_CODE },
    },
    create: {
      storeId: store.id,
      code: E2E_PRODUCTION_LOCATION_CODE,
      kind: LocationKind.PRODUCTION,
    },
    update: { kind: LocationKind.PRODUCTION },
  });
  await db.storeSettings.upsert({
    where: { storeId: store.id },
    create: {
      tenantId: baseline.tenantId,
      storeId: store.id,
      deliveryConfig: {},
      capacityConfig: {},
    },
    update: {},
  });

  for (const account of accounts) {
    await applyStaffAccount(
      db,
      { tenantId: baseline.tenantId, storeId: store.id },
      account,
    );
  }

  const batches = [
    {
      batchNo: E2E_BATCH_CODES.flower,
      materialId: p1.flowerMaterialId,
      onHandQty: E2E_BATCH_ON_HAND_QTY.flower,
    },
    {
      batchNo: E2E_BATCH_CODES.consumable,
      materialId: p1.consumableMaterialId,
      onHandQty: E2E_BATCH_ON_HAND_QTY.consumable,
    },
  ] as const;
  for (const fixture of batches) {
    const batch = await db.inventoryBatch.upsert({
      where: {
        storeId_batchNo: { storeId: store.id, batchNo: fixture.batchNo },
      },
      create: {
        storeId: store.id,
        materialId: fixture.materialId,
        batchNo: fixture.batchNo,
        receivedAt: E2E_BATCH_RECEIVED_AT,
        usableUntil: null,
        unitCost: E2E_BATCH_UNIT_COST,
        costEstimated: true,
      },
      update: {
        materialId: fixture.materialId,
        unitCost: E2E_BATCH_UNIT_COST,
        costEstimated: true,
      },
    });
    await db.batchBalance.upsert({
      where: {
        batchId_locationId: { batchId: batch.id, locationId: stock.id },
      },
      create: {
        batchId: batch.id,
        locationId: stock.id,
        onHandQty: fixture.onHandQty,
        frozenQty: 0,
      },
      update: {},
    });
  }

  return {
    storeId: store.id,
    stockLocationId: stock.id,
    productionLocationId: production.id,
  };
}

/** Accounts for the orchestrator to hash before opening the seed transaction. */
export function e2eStaffAccounts(): readonly SeedAccount[] {
  return E2E_STAFF;
}
