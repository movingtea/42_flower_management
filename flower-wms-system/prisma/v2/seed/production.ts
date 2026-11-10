import { PrismaClient } from "../../../src/generated/prisma-v2/client";
import { applyMinimum } from "./minimum";

/**
 * Production bootstrap: the tenant/store baseline plus exactly one bootstrap
 * admin. It preserves the historical behaviour of never rewriting existing
 * credentials or memberships.
 */
export type ProductionBootstrapInput = {
  username: string;
  passwordHash: string;
};

export async function runProductionBootstrap(
  client: PrismaClient,
  input: ProductionBootstrapInput,
): Promise<boolean> {
  let seeded = false;
  await client.$transaction(
    async (tx) => {
      const baseline = await applyMinimum(tx);
      // `skipDuplicates` makes a concurrent bootstrap a no-op instead of
      // overwriting the first credentials that won.
      const inserted = await tx.staffUser.createMany({
        data: {
          username: input.username,
          passwordHash: input.passwordHash,
          displayName: "系统管理员",
          mustChangePassword: true,
        },
        skipDuplicates: true,
      });
      if (inserted.count === 0) return;

      const staff = await tx.staffUser.upsert({
        where: { username: input.username },
        create: {
          username: input.username,
          passwordHash: input.passwordHash,
          displayName: "系统管理员",
        },
        update: {},
      });
      await tx.tenantMember.upsert({
        where: {
          tenantId_staffUserId: {
            tenantId: baseline.tenantId,
            staffUserId: staff.id,
          },
        },
        create: {
          tenantId: baseline.tenantId,
          staffUserId: staff.id,
          roles: ["ADMIN"],
        },
        update: { roles: ["ADMIN"], active: true },
      });
      await tx.storeMember.upsert({
        where: {
          storeId_staffUserId: {
            storeId: baseline.storeId,
            staffUserId: staff.id,
          },
        },
        create: {
          storeId: baseline.storeId,
          staffUserId: staff.id,
          roles: ["ADMIN"],
        },
        update: { roles: ["ADMIN"], active: true },
      });
      seeded = true;
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
  return seeded;
}
