import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { LocationKind, PrismaClient } from "../../src/generated/prisma-v2-draft/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for the v2 seed");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const TEST_STAFF = [
  { username: "admin", password: "admin", displayName: "系统管理员", roles: ["ADMIN"] },
  { username: "manager", password: "manager", displayName: "门店经理", roles: ["MANAGER"] },
  { username: "buyer", password: "buyer", displayName: "采购人员", roles: ["BUYER"] },
  { username: "sales", password: "sales", displayName: "订单履约人员", roles: ["SALES"] },
  { username: "florist", password: "florist", displayName: "花艺师", roles: ["FLORIST"] },
] as const;

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: "default" },
    create: { slug: "default", name: "默认花店" },
    update: {},
  });
  const store = await db.store.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } },
    create: { tenantId: tenant.id, code: "MAIN", name: "主店" },
    update: {},
  });
  await db.inventoryLocation.upsert({
    where: { storeId_code: { storeId: store.id, code: "STOCK" } },
    create: { storeId: store.id, code: "STOCK", kind: LocationKind.WAREHOUSE },
    update: {},
  });
  await db.inventoryLocation.upsert({
    where: { storeId_code: { storeId: store.id, code: "PRODUCTION" } },
    create: { storeId: store.id, code: "PRODUCTION", kind: LocationKind.PRODUCTION },
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
  for (const account of TEST_STAFF) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    const staff = await db.staffUser.upsert({
      where: { username: account.username },
      create: {
        username: account.username,
        passwordHash,
        displayName: account.displayName,
      },
      update: {
        passwordHash,
        displayName: account.displayName,
        active: true,
      },
    });
    await db.tenantMember.upsert({
      where: { tenantId_staffUserId: { tenantId: tenant.id, staffUserId: staff.id } },
      create: { tenantId: tenant.id, staffUserId: staff.id, roles: [...account.roles] },
      update: { roles: [...account.roles], active: true },
    });
    await db.storeMember.upsert({
      where: { storeId_staffUserId: { storeId: store.id, staffUserId: staff.id } },
      create: { storeId: store.id, staffUserId: staff.id, roles: [...account.roles] },
      update: { roles: [...account.roles], active: true },
    });
  }
  console.log(`Seeded tenant ${tenant.slug} and store ${store.code}`);
  console.log(`Seeded ${TEST_STAFF.length} v2 test staff accounts`);
}

main().finally(() => db.$disconnect());
