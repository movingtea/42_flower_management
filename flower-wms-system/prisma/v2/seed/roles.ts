import { applyStaffAccount, type HashedSeedAccount, type SeedAccount } from "./accounts";
import type { SeedBaseline, SeedTransaction, TieredSeedMode } from "./types";

/**
 * `roles` tier: the five synthetic test staff accounts and their tenant/store
 * memberships. This mirrors the accounts the existing test seed has always
 * created; `dev` only needs the admin account and keeps that historical subset.
 */
export const TEST_STAFF: readonly SeedAccount[] = [
  { username: "admin", password: "admin", displayName: "系统管理员", roles: ["ADMIN"] },
  { username: "manager", password: "manager", displayName: "门店经理", roles: ["MANAGER"] },
  { username: "buyer", password: "buyer", displayName: "采购人员", roles: ["BUYER"] },
  { username: "sales", password: "sales", displayName: "订单履约人员", roles: ["SALES"] },
  { username: "florist", password: "florist", displayName: "花艺师", roles: ["FLORIST"] },
] as const;

/** Historical mode split: dev seeds only the bootstrap admin, test seeds all five. */
export function testStaffAccountsForMode(
  mode: TieredSeedMode,
): readonly SeedAccount[] {
  return mode === "dev" ? TEST_STAFF.slice(0, 1) : TEST_STAFF;
}

export async function applyRoles(
  db: SeedTransaction,
  baseline: SeedBaseline,
  accounts: readonly HashedSeedAccount[],
): Promise<void> {
  for (const account of accounts) {
    await applyStaffAccount(
      db,
      { tenantId: baseline.tenantId, storeId: baseline.storeId },
      account,
    );
  }
}
