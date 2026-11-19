import { PrismaClient } from "../../../src/generated/prisma-v2/client";
import { hashSeedAccounts } from "./accounts";
import {
  DEFAULT_TEST_TIERS,
  formatTierList,
  resolveTierClosure,
  type SeedTier,
} from "./contract";
import { applyE2EFixtures, e2eStaffAccounts } from "./e2e-fixtures";
import { applyMinimum } from "./minimum";
import { applyP1Scenarios, type P1ScenarioRefs } from "./p1-scenarios";
import { applyRoles, testStaffAccountsForMode } from "./roles";
import type { TieredSeedMode } from "./types";

export type TieredSeedOptions = {
  mode: TieredSeedMode;
  /** Requested tiers; dependencies are added automatically. */
  tiers: readonly SeedTier[];
  log?: (message: string) => void;
};

export type TieredSeedResult = {
  appliedTiers: readonly SeedTier[];
};

/**
 * Apply the requested tier closure in one transaction.
 *
 * Bcrypt hashing happens before the transaction so the interactive transaction
 * only performs fast upserts and stays clear of Prisma's transaction timeout.
 */
export async function runTieredSeed(
  client: PrismaClient,
  options: TieredSeedOptions,
): Promise<TieredSeedResult> {
  const log = options.log ?? ((message: string) => console.log(message));
  const selected = options.tiers.length > 0 ? options.tiers : DEFAULT_TEST_TIERS;
  const appliedTiers = resolveTierClosure(selected);

  const roleAccounts = await hashSeedAccounts(
    testStaffAccountsForMode(options.mode),
  );
  const e2eAccounts = appliedTiers.includes("e2e-fixtures")
    ? await hashSeedAccounts(e2eStaffAccounts())
    : [];

  await client.$transaction(
    async (tx) => {
      const baseline = await applyMinimum(tx);
      const applyRolesTier = appliedTiers.includes("roles");
      if (applyRolesTier) {
        await applyRoles(tx, baseline, roleAccounts);
      }

      let p1: P1ScenarioRefs | undefined;
      if (appliedTiers.includes("p1-scenarios")) {
        p1 = await applyP1Scenarios(tx, baseline);
      }
      if (appliedTiers.includes("e2e-fixtures")) {
        if (!p1) throw new Error("e2e-fixtures requires p1-scenarios");
        await applyE2EFixtures(tx, baseline, p1, e2eAccounts);
      }

      log(`Seeded tenant ${baseline.tenantSlug} and store ${baseline.storeCode}`);
    },
    { maxWait: 15_000, timeout: 60_000 },
  );

  log(`Applied seed tiers: ${formatTierList(appliedTiers)}`);
  return { appliedTiers };
}
