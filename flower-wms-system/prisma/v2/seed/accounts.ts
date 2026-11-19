import bcrypt from "bcryptjs";
import type { SeedBaseline, SeedTransaction } from "./types";

/** Matches the historical V2 test seed hashing cost. */
export const SEED_BCRYPT_ROUNDS = 12;

export type SeedAccount = {
  username: string;
  password: string;
  displayName: string;
  roles: readonly string[];
};

export type HashedSeedAccount = Omit<SeedAccount, "password"> & {
  passwordHash: string;
};

/**
 * Hashing is kept outside the seed transaction so PostgreSQL transaction
 * timeouts never race slow bcrypt work.
 */
export async function hashSeedAccounts(
  accounts: readonly SeedAccount[],
): Promise<HashedSeedAccount[]> {
  return Promise.all(
    accounts.map(async (account) => ({
      username: account.username,
      displayName: account.displayName,
      roles: [...account.roles],
      passwordHash: await bcrypt.hash(account.password, SEED_BCRYPT_ROUNDS),
    })),
  );
}

export type StaffAccountScope = {
  tenantId: string;
  storeId: string;
};

/**
 * Upsert one synthetic/test staff account plus its tenant and store memberships.
 * Password and display name are rewritten on every apply, matching the existing
 * test-seed behaviour (known test credentials stay usable after a reset).
 */
export async function applyStaffAccount(
  db: SeedTransaction,
  scope: StaffAccountScope,
  account: HashedSeedAccount,
): Promise<void> {
  const staff = await db.staffUser.upsert({
    where: { username: account.username },
    create: {
      username: account.username,
      passwordHash: account.passwordHash,
      displayName: account.displayName,
    },
    update: {
      passwordHash: account.passwordHash,
      displayName: account.displayName,
      active: true,
    },
  });
  await db.tenantMember.upsert({
    where: {
      tenantId_staffUserId: { tenantId: scope.tenantId, staffUserId: staff.id },
    },
    create: {
      tenantId: scope.tenantId,
      staffUserId: staff.id,
      roles: [...account.roles],
    },
    update: { roles: [...account.roles], active: true },
  });
  await db.storeMember.upsert({
    where: {
      storeId_staffUserId: { storeId: scope.storeId, staffUserId: staff.id },
    },
    create: {
      storeId: scope.storeId,
      staffUserId: staff.id,
      roles: [...account.roles],
    },
    update: { roles: [...account.roles], active: true },
  });
}

/** Unused helper kept close to the baseline type for tier modules that only need ids. */
export function baselineScope(baseline: SeedBaseline): StaffAccountScope {
  return { tenantId: baseline.tenantId, storeId: baseline.storeId };
}
