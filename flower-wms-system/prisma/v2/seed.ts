import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { LocationKind, PrismaClient } from "../../src/generated/prisma-v2/client";
import { isStrongV2Password } from "../../src/v2/password-policy";

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const mode = process.argv[2];
if (mode !== "test" && mode !== "dev" && mode !== "reset-test" && mode !== "production") {
  throw new Error("Choose a db:v2:seed, db:v2:reset or db:v2:init package command");
}
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname ||
    !/^\/[a-z][a-z0-9_]*$/.test(target.pathname)) {
  throw new Error("V2_DATABASE_URL must name a PostgreSQL database");
}
if (process.env.DATABASE_URL &&
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname) === target.pathname) {
  throw new Error("V1 and V2 must use distinct PostgreSQL database names");
}
if (mode !== "production") {
  const suffix = mode === "dev" ? "_dev" : "_test";
  if (process.env.NODE_ENV === "production" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !target.pathname.endsWith(suffix) ||
      [...target.searchParams].some(([key, value]) => key !== "schema" || value !== "public")) {
    throw new Error(`Use a local PostgreSQL database ending in ${suffix} with the public schema`);
  }
}

if (mode === "reset-test") {
  execFileSync(process.execPath, [
    resolve("node_modules/prisma/build/index.js"), "migrate", "reset", "--force",
    "--config", "prisma.v2.config.ts",
  ], { stdio: "inherit" });
}

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const TEST_STAFF = [
  { username: "admin", password: "admin", displayName: "系统管理员", roles: ["ADMIN"] },
  { username: "manager", password: "manager", displayName: "门店经理", roles: ["MANAGER"] },
  { username: "buyer", password: "buyer", displayName: "采购人员", roles: ["BUYER"] },
  { username: "sales", password: "sales", displayName: "订单履约人员", roles: ["SALES"] },
  { username: "florist", password: "florist", displayName: "花艺师", roles: ["FLORIST"] },
] as const;

async function main() {
  const production = mode === "production";
  const username = process.env.V2_BOOTSTRAP_ADMIN_USERNAME?.trim();
  const passwordFile = process.env.V2_BOOTSTRAP_ADMIN_PASSWORD_FILE;
  if (production && (!username || !passwordFile)) {
    throw new Error("Set V2_BOOTSTRAP_ADMIN_USERNAME and V2_BOOTSTRAP_ADMIN_PASSWORD_FILE");
  }
  if (production && username && await client.staffUser.findUnique({ where: { username } })) {
    console.log("Bootstrap username already exists. Existing credentials and memberships were preserved.");
    return;
  }
  const password = production ? (await readFile(passwordFile!, "utf8")).replace(/\r?\n$/, "") : "";
  if (production && !isStrongV2Password(password, username!)) {
    throw new Error("The bootstrap password does not meet the V2 password policy");
  }
  const accounts = production
    ? [{ username: username!, password, displayName: "系统管理员", roles: ["ADMIN"] }]
    : mode === "dev" ? TEST_STAFF.slice(0, 1) : TEST_STAFF;
  const hashedAccounts = await Promise.all(accounts.map(async (account) => ({
    ...account,
    passwordHash: await bcrypt.hash(account.password, 12),
  })));

  await client.$transaction(async (db) => {
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
    for (const account of hashedAccounts) {
      if (production) {
        const inserted = await db.staffUser.createMany({
          data: {
            username: account.username,
            passwordHash: account.passwordHash,
            displayName: account.displayName,
            mustChangePassword: true,
          },
          skipDuplicates: true,
        });
        if (inserted.count === 0) return;
      }
      const staff = await db.staffUser.upsert({
        where: { username: account.username },
        create: {
          username: account.username,
          passwordHash: account.passwordHash,
          displayName: account.displayName,
        },
        update: production ? {} : {
          passwordHash: account.passwordHash,
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
  });
}

main().finally(() => client.$disconnect());
