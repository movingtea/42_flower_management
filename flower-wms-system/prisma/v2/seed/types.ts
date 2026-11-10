import type { Prisma } from "../../../src/generated/prisma-v2/client";

/** Existing seed CLI modes. `reset-test` migrates a throw-away test database first. */
export const SEED_MODES = ["test", "dev", "reset-test", "production"] as const;

export type SeedMode = (typeof SEED_MODES)[number];

/** Modes that use the tiered local/test dataset flow. */
export type TieredSeedMode = Exclude<SeedMode, "production">;

/** Database handle used by the tier modules; the orchestrator owns the transaction. */
export type SeedTransaction = Prisma.TransactionClient;

/** Identity of the baseline tenant/store/locations every tier builds on. */
export type SeedBaseline = {
  tenantId: string;
  tenantSlug: string;
  storeId: string;
  storeCode: string;
  stockLocationId: string;
  stockLocationCode: string;
  productionLocationId: string;
  productionLocationCode: string;
};
