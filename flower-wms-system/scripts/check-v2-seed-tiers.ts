#!/usr/bin/env node
/**
 * E1.4 seed-tier checker.
 *
 * Usage:
 *   node node_modules/tsx/dist/cli.mjs scripts/check-v2-seed-tiers.ts \
 *     --tiers=roles,e2e-fixtures [--expect-absent=minimum] \
 *     [--expect-no-transactions] [--label=<text>]
 *
 * Asserts that the requested seed-tier closure is present exactly once per
 * fixture row (no duplicates), that the complement of the closure is absent,
 * and that reference data stays free of transactional rows. It is read-only.
 *
 * The script intentionally lives in `scripts/`, not `scripts/v2/`: `scripts/v2`
 * is auto-discovered as the V2 smoke suite and must keep its four known files.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  LocationKind,
  MaterialKind,
  PrismaClient,
  RecipeState,
} from "../src/generated/prisma-v2/client";
import {
  DEFAULT_TEST_TIERS,
  SEED_TIERS,
  formatTierList,
  parseTierList,
  resolveTierClosure,
  type SeedTier,
} from "../prisma/v2/seed/contract";
import {
  DEFAULT_STORE_CODE,
  DEFAULT_TENANT_SLUG,
  PRODUCTION_LOCATION_CODE,
  STOCK_LOCATION_CODE,
} from "../prisma/v2/seed/minimum";
import {
  E2E_BATCH_CODES,
  E2E_BATCH_ON_HAND_QTY,
  E2E_PRODUCTION_LOCATION_CODE,
  E2E_STAFF,
  E2E_STAFF_PASSWORD,
  E2E_STOCK_LOCATION_CODE,
  E2E_STORE_CODE,
} from "../prisma/v2/seed/e2e-fixtures";
import {
  P1_BATCH_NO,
  P1_BATCH_ON_HAND_QTY,
  P1_CONSUMABLE_MATERIAL_CODE,
  P1_FLOWER_MATERIAL_CODE,
  P1_PRODUCT_CODE,
  P1_RECIPE_VERSION_NO,
  P1_SKU_CODE,
  P1_SUPPLIER_CODE,
} from "../prisma/v2/seed/p1-scenarios";
import { TEST_STAFF } from "../prisma/v2/seed/roles";
import { loadV2Env } from "./load-v2-env.mjs";

loadV2Env();

type CheckOptions = {
  expected: SeedTier[];
  absent: SeedTier[];
  expectNoTransactions: boolean;
  label: string;
};

const USAGE =
  "Usage: check-v2-seed-tiers.ts [--tiers=minimum,roles,p1-scenarios,e2e-fixtures] " +
  "[--expect-absent=<tier,...>] [--expect-no-transactions] [--label=<text>]";

function parseOptions(argv: readonly string[]): CheckOptions {
  let rawTiers: string | undefined;
  let rawAbsent: string | undefined;
  let expectNoTransactions = false;
  let label = "";

  for (const arg of argv) {
    if (arg.startsWith("--tiers=")) {
      if (rawTiers !== undefined) throw new Error("--tiers 只能提供一次");
      rawTiers = arg.slice("--tiers=".length);
      continue;
    }
    if (arg.startsWith("--expect-absent=")) {
      if (rawAbsent !== undefined) throw new Error("--expect-absent 只能提供一次");
      rawAbsent = arg.slice("--expect-absent=".length);
      continue;
    }
    if (arg === "--expect-no-transactions") {
      expectNoTransactions = true;
      continue;
    }
    if (arg.startsWith("--label=")) {
      label = arg.slice("--label=".length);
      continue;
    }
    throw new Error(`未知参数 "${arg}"`);
  }

  const requested =
    rawTiers === undefined ? [...DEFAULT_TEST_TIERS] : parseTierList(rawTiers);
  const closure = resolveTierClosure(requested);
  const absent =
    rawAbsent === undefined
      ? SEED_TIERS.filter((tier) => !closure.includes(tier))
      : parseTierList(rawAbsent).filter((tier) => tier !== "minimum");
  return { expected: closure, absent, expectNoTransactions, label };
}

const options = parseOptions(process.argv.slice(2));

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const failures: string[] = [];
let checks = 0;

function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) failures.push(message);
}

function checkEqual<T>(actual: T, expected: T, message: string): void {
  check(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function checkBaseline() {
  const tenants = await db.tenant.findMany({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true, slug: true },
  });
  checkEqual(tenants.length, 1, "minimum: 默认租户应恰好一条");
  const tenant = tenants[0];
  if (!tenant) return undefined;

  const stores = await db.store.findMany({
    where: { tenantId: tenant.id, code: DEFAULT_STORE_CODE },
    select: { id: true, code: true, name: true },
  });
  checkEqual(stores.length, 1, "minimum: MAIN 门店应恰好一条");
  const store = stores[0];
  if (!store) return undefined;

  const locations = await db.inventoryLocation.findMany({
    where: { storeId: store.id },
    select: { id: true, code: true, kind: true },
  });
  checkEqual(locations.length, 2, "minimum: MAIN 门店应恰好两个库位");
  const stock = locations.filter((location) => location.code === STOCK_LOCATION_CODE);
  const production = locations.filter(
    (location) => location.code === PRODUCTION_LOCATION_CODE,
  );
  checkEqual(stock.length, 1, "minimum: STOCK 库位应恰好一条");
  checkEqual(production.length, 1, "minimum: PRODUCTION 库位应恰好一条");
  if (stock[0]) {
    checkEqual(stock[0].kind, LocationKind.WAREHOUSE, "minimum: STOCK 应为仓库库位");
  }
  if (production[0]) {
    checkEqual(
      production[0].kind,
      LocationKind.PRODUCTION,
      "minimum: PRODUCTION 应为制作库位",
    );
  }

  const settings = await db.storeSettings.findMany({
    where: { storeId: store.id },
    select: { id: true, tenantId: true },
  });
  checkEqual(settings.length, 1, "minimum: MAIN 门店设置应恰好一条");
  if (settings[0]) {
    checkEqual(settings[0].tenantId, tenant.id, "minimum: 门店设置应属于默认租户");
  }

  return {
    tenantId: tenant.id,
    storeId: store.id,
    stockLocationId: stock[0]?.id,
  };
}

async function checkNoTransactions(): Promise<void> {
  const [orders, purchases, reservations, holds, tasks, usages] = await Promise.all([
    db.order.count(),
    db.purchaseOrder.count(),
    db.inventoryReservation.count(),
    db.availabilityHold.count(),
    db.productionTask.count(),
    db.materialUsage.count(),
  ]);
  checkEqual(orders, 0, "p1-scenarios: 不应创建订单");
  checkEqual(purchases, 0, "p1-scenarios: 不应创建采购单");
  checkEqual(reservations, 0, "p1-scenarios: 不应创建库存预留");
  checkEqual(holds, 0, "p1-scenarios: 不应创建库存占用");
  checkEqual(tasks, 0, "p1-scenarios: 不应创建制作任务");
  checkEqual(usages, 0, "p1-scenarios: 不应创建实际用料记录");
}

type StaffFixture = (typeof TEST_STAFF)[number];

async function checkStaff(
  baseline: { tenantId: string; storeId: string },
  accounts: readonly StaffFixture[],
  label: string,
): Promise<void> {
  const staff = await db.staffUser.findMany({
    where: { username: { in: accounts.map((account) => account.username) } },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      displayName: true,
      active: true,
    },
  });
  for (const account of accounts) {
    const matches = staff.filter((row) => row.username === account.username);
    checkEqual(matches.length, 1, `${label}: 账号 ${account.username} 应恰好一条`);
    const row = matches[0];
    if (!row) continue;
    check(row.active, `${label}: 账号 ${account.username} 应启用`);
    const passwordMatches = await bcrypt.compare(account.password, row.passwordHash);
    check(passwordMatches, `${label}: 账号 ${account.username} 密码应可登录`);
    const tenantMembers = await db.tenantMember.findMany({
      where: { tenantId: baseline.tenantId, staffUserId: row.id },
      select: { roles: true, active: true },
    });
    checkEqual(tenantMembers.length, 1, `${label}: ${account.username} 租户成员关系应恰好一条`);
    if (tenantMembers[0]) {
      check(tenantMembers[0].active, `${label}: ${account.username} 租户成员关系应有效`);
      check(
        sameStringSet(tenantMembers[0].roles, account.roles),
        `${label}: ${account.username} 租户角色应为 ${account.roles.join(",")}`,
      );
    }
    const storeMembers = await db.storeMember.findMany({
      where: { storeId: baseline.storeId, staffUserId: row.id },
      select: { roles: true, active: true },
    });
    checkEqual(storeMembers.length, 1, `${label}: ${account.username} 门店成员关系应恰好一条`);
    if (storeMembers[0]) {
      check(storeMembers[0].active, `${label}: ${account.username} 门店成员关系应有效`);
      check(
        sameStringSet(storeMembers[0].roles, account.roles),
        `${label}: ${account.username} 门店角色应为 ${account.roles.join(",")}`,
      );
    }
  }
}

type Baseline = NonNullable<Awaited<ReturnType<typeof checkBaseline>>>;

async function checkP1Scenarios(baseline: Baseline): Promise<void> {
  const supplier = await db.supplier.findMany({
    where: { tenantId: baseline.tenantId, code: P1_SUPPLIER_CODE },
    select: { id: true, active: true },
  });
  checkEqual(supplier.length, 1, "p1-scenarios: 参考供应商应恰好一条");
  check(!supplier[0] || supplier[0].active, "p1-scenarios: 参考供应商应启用");

  const flower = await db.material.findMany({
    where: { tenantId: baseline.tenantId, code: P1_FLOWER_MATERIAL_CODE },
    select: { id: true, kind: true, active: true },
  });
  const consumable = await db.material.findMany({
    where: { tenantId: baseline.tenantId, code: P1_CONSUMABLE_MATERIAL_CODE },
    select: { id: true, kind: true, active: true },
  });
  checkEqual(flower.length, 1, "p1-scenarios: 花材应恰好一条");
  checkEqual(consumable.length, 1, "p1-scenarios: 耗材应恰好一条");
  check(!flower[0] || flower[0].active, "p1-scenarios: 花材应启用");
  check(!consumable[0] || consumable[0].active, "p1-scenarios: 耗材应启用");
  if (flower[0]) {
    checkEqual(flower[0].kind, MaterialKind.FLOWER, "p1-scenarios: 花材类别应为 FLOWER");
  }
  if (consumable[0]) {
    checkEqual(
      consumable[0].kind,
      MaterialKind.CONSUMABLE,
      "p1-scenarios: 耗材类别应为 CONSUMABLE",
    );
  }

  const products = await db.product.findMany({
    where: { tenantId: baseline.tenantId, code: P1_PRODUCT_CODE },
    select: { id: true, active: true, defaultSkuId: true },
  });
  checkEqual(products.length, 1, "p1-scenarios: 参考 SPU 应恰好一条");
  const product = products[0];
  check(!product || product.active, "p1-scenarios: 参考 SPU 应启用");
  if (!product) return;

  const skus = await db.productSku.findMany({
    where: { productId: product.id, code: P1_SKU_CODE },
    select: { id: true, active: true },
  });
  checkEqual(skus.length, 1, "p1-scenarios: 参考 SKU 应恰好一条");
  check(!skus[0] || skus[0].active, "p1-scenarios: 参考 SKU 应启用");
  if (skus[0]) {
    checkEqual(
      product.defaultSkuId,
      skus[0].id,
      "p1-scenarios: 参考 SPU 默认 SKU 应指向参考 SKU",
    );
  }

  const recipes = await db.recipe.findMany({
    where: { skuId: skus[0]?.id ?? "__missing__" },
    select: { id: true },
  });
  checkEqual(recipes.length, 1, "p1-scenarios: 参考 SKU 配方应恰好一条");
  const recipe = recipes[0];
  if (!recipe) return;

  const versions = await db.recipeVersion.findMany({
    where: { recipeId: recipe.id, versionNo: P1_RECIPE_VERSION_NO },
    select: { id: true, state: true, publishedAt: true, effectiveAt: true },
  });
  checkEqual(versions.length, 1, "p1-scenarios: 已发布配方版本应恰好一条");
  const version = versions[0];
  if (!version) return;
  checkEqual(
    version.state,
    RecipeState.PUBLISHED,
    "p1-scenarios: 配方版本应为 PUBLISHED",
  );
  check(version.publishedAt instanceof Date, "p1-scenarios: 配方版本应有发布时间");
  check(version.effectiveAt instanceof Date, "p1-scenarios: 配方版本应有生效时间");

  const lines = await db.recipeLine.findMany({
    where: { versionId: version.id },
    select: { materialId: true, plannedQty: true },
  });
  checkEqual(lines.length, 2, "p1-scenarios: 配方应恰好两条物料行");
  checkEqual(
    new Set(lines.map((line) => line.materialId)).size,
    lines.length,
    "p1-scenarios: 配方物料不得重复",
  );
  check(
    sameStringSet(
      lines.map((line) => line.materialId),
      [flower[0]?.id ?? "__flower__", consumable[0]?.id ?? "__consumable__"],
    ),
    "p1-scenarios: 配方行应引用参考花材和耗材",
  );
  const quantityByMaterial = new Map(
    lines.map((line) => [line.materialId, Number(line.plannedQty)]),
  );
  if (flower[0]) {
    checkEqual(quantityByMaterial.get(flower[0].id), 11, "p1-scenarios: 花材用量应为 11");
  }
  if (consumable[0]) {
    checkEqual(quantityByMaterial.get(consumable[0].id), 2, "p1-scenarios: 耗材用量应为 2");
  }

  if (flower[0] && baseline.stockLocationId) {
    const batches = await db.inventoryBatch.findMany({
      where: { storeId: baseline.storeId, batchNo: P1_BATCH_NO },
      select: { id: true, materialId: true },
    });
    checkEqual(batches.length, 1, "p1-scenarios: 参考库存批次应恰好一条");
    if (batches[0]) {
      checkEqual(batches[0].materialId, flower[0].id, "p1-scenarios: 参考批次应引用花材");
      const balances = await db.batchBalance.findMany({
        where: { batchId: batches[0].id, locationId: baseline.stockLocationId },
        select: { onHandQty: true },
      });
      checkEqual(balances.length, 1, "p1-scenarios: 参考批次余额应恰好一条");
      if (balances[0]) {
        checkEqual(
          Number(balances[0].onHandQty),
          P1_BATCH_ON_HAND_QTY,
          "p1-scenarios: 参考批次应有余量",
        );
      }
    }
  }
}

async function checkE2EFixtures(baseline: Baseline): Promise<void> {
  const stores = await db.store.findMany({
    where: { tenantId: baseline.tenantId, code: E2E_STORE_CODE },
    select: { id: true },
  });
  checkEqual(stores.length, 1, "e2e-fixtures: E2E 门店应恰好一条");
  const store = stores[0];
  if (!store) return;

  const locations = await db.inventoryLocation.findMany({
    where: { storeId: store.id },
    select: { id: true, code: true, kind: true },
  });
  checkEqual(locations.length, 2, "e2e-fixtures: E2E 门店应恰好两个库位");
  const stock = locations.filter((location) => location.code === E2E_STOCK_LOCATION_CODE);
  const production = locations.filter(
    (location) => location.code === E2E_PRODUCTION_LOCATION_CODE,
  );
  checkEqual(stock.length, 1, "e2e-fixtures: E2E 仓库库位应恰好一条");
  checkEqual(production.length, 1, "e2e-fixtures: E2E 制作库位应恰好一条");
  if (stock[0]) {
    checkEqual(stock[0].kind, LocationKind.WAREHOUSE, "e2e-fixtures: E2E 仓库库位类别");
  }
  if (production[0]) {
    checkEqual(
      production[0].kind,
      LocationKind.PRODUCTION,
      "e2e-fixtures: E2E 制作库位类别",
    );
  }

  const settings = await db.storeSettings.findMany({
    where: { storeId: store.id },
    select: { id: true },
  });
  checkEqual(settings.length, 1, "e2e-fixtures: E2E 门店设置应恰好一条");

  const staff = await db.staffUser.findMany({
    where: { username: { in: E2E_STAFF.map((account) => account.username) } },
    select: { id: true, username: true, passwordHash: true, active: true },
  });
  for (const account of E2E_STAFF) {
    const matches = staff.filter((row) => row.username === account.username);
    checkEqual(matches.length, 1, `e2e-fixtures: 账号 ${account.username} 应恰好一条`);
    const row = matches[0];
    if (!row) continue;
    check(row.active, `e2e-fixtures: 账号 ${account.username} 应启用`);
    check(
      await bcrypt.compare(E2E_STAFF_PASSWORD, row.passwordHash),
      `e2e-fixtures: 账号 ${account.username} 应可使用合成密码登录`,
    );
    const tenantMembers = await db.tenantMember.findMany({
      where: { tenantId: baseline.tenantId, staffUserId: row.id },
      select: { roles: true, active: true },
    });
    checkEqual(tenantMembers.length, 1, `e2e-fixtures: ${account.username} 租户成员关系`);
    if (tenantMembers[0]) {
      check(tenantMembers[0].active, `e2e-fixtures: ${account.username} 租户成员应有效`);
      check(
        sameStringSet(tenantMembers[0].roles, account.roles),
        `e2e-fixtures: ${account.username} 租户角色应为 ${account.roles.join(",")}`,
      );
    }
    const storeMembers = await db.storeMember.findMany({
      where: { storeId: store.id, staffUserId: row.id },
      select: { roles: true, active: true },
    });
    checkEqual(storeMembers.length, 1, `e2e-fixtures: ${account.username} E2E 成员关系`);
    if (storeMembers[0]) {
      check(storeMembers[0].active, `e2e-fixtures: ${account.username} E2E 成员应有效`);
      check(
        sameStringSet(storeMembers[0].roles, account.roles),
        `e2e-fixtures: ${account.username} E2E 角色应为 ${account.roles.join(",")}`,
      );
    }
  }

  const batchFixtures = [
    {
      batchNo: E2E_BATCH_CODES.flower,
      materialCode: P1_FLOWER_MATERIAL_CODE,
      onHandQty: E2E_BATCH_ON_HAND_QTY.flower,
    },
    {
      batchNo: E2E_BATCH_CODES.consumable,
      materialCode: P1_CONSUMABLE_MATERIAL_CODE,
      onHandQty: E2E_BATCH_ON_HAND_QTY.consumable,
    },
  ] as const;
  for (const fixture of batchFixtures) {
    const material = await db.material.findFirst({
      where: { tenantId: baseline.tenantId, code: fixture.materialCode },
      select: { id: true },
    });
    const batches = await db.inventoryBatch.findMany({
      where: { storeId: store.id, batchNo: fixture.batchNo },
      select: { id: true, materialId: true },
    });
    checkEqual(batches.length, 1, `e2e-fixtures: ${fixture.batchNo} 应恰好一条`);
    if (!batches[0] || !material) continue;
    checkEqual(batches[0].materialId, material.id, `e2e-fixtures: ${fixture.batchNo} 物料`);
    if (stock[0]) {
      const balances = await db.batchBalance.findMany({
        where: { batchId: batches[0].id, locationId: stock[0].id },
        select: { onHandQty: true },
      });
      checkEqual(balances.length, 1, `e2e-fixtures: ${fixture.batchNo} 余额应恰好一条`);
      if (balances[0]) {
        checkEqual(
          Number(balances[0].onHandQty),
          fixture.onHandQty,
          `e2e-fixtures: ${fixture.batchNo} 应有余量`,
        );
      }
    }
  }
}

async function checkAbsence(baseline: Baseline): Promise<void> {
  if (options.absent.includes("roles")) {
    const staff = await db.staffUser.count({
      where: { username: { in: TEST_STAFF.map((account) => account.username) } },
    });
    checkEqual(staff, 0, "roles: 未请求 roles 时不应存在测试账号");
  }
  if (options.absent.includes("p1-scenarios")) {
    const suppliers = await db.supplier.count({
      where: { tenantId: baseline.tenantId, code: P1_SUPPLIER_CODE },
    });
    const materials = await db.material.count({
      where: {
        tenantId: baseline.tenantId,
        code: { in: [P1_FLOWER_MATERIAL_CODE, P1_CONSUMABLE_MATERIAL_CODE] },
      },
    });
    const products = await db.product.count({
      where: { tenantId: baseline.tenantId, code: P1_PRODUCT_CODE },
    });
    const batches = await db.inventoryBatch.count({
      where: { storeId: baseline.storeId, batchNo: P1_BATCH_NO },
    });
    checkEqual(suppliers, 0, "p1-scenarios: 未请求时不应存在参考供应商");
    checkEqual(materials, 0, "p1-scenarios: 未请求时不应存在参考物料");
    checkEqual(products, 0, "p1-scenarios: 未请求时不应存在参考 SPU");
    checkEqual(batches, 0, "p1-scenarios: 未请求时不应存在参考批次");
  }
  if (options.absent.includes("e2e-fixtures")) {
    const stores = await db.store.count({
      where: { tenantId: baseline.tenantId, code: E2E_STORE_CODE },
    });
    const staff = await db.staffUser.count({
      where: { username: { in: E2E_STAFF.map((account) => account.username) } },
    });
    checkEqual(stores, 0, "e2e-fixtures: 未请求时不应存在 E2E 门店");
    checkEqual(staff, 0, "e2e-fixtures: 未请求时不应存在 E2E 合成账号");
  }
}

async function main(): Promise<number> {
  console.log(
    `check-v2-seed-tiers: database ${databaseName}; expected tiers ` +
      `${formatTierList(options.expected)}; absent ${formatTierList(options.absent) || "(none)"}` +
      (options.label ? `; label ${options.label}` : ""),
  );

  const baseline = await checkBaseline();
  if (!baseline) {
    console.error("check-v2-seed-tiers: FAILED (baseline tenant/store missing)");
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }

  if (options.expected.includes("roles")) {
    await checkStaff(baseline, TEST_STAFF, "roles");
  }
  if (options.expected.includes("p1-scenarios")) {
    await checkP1Scenarios(baseline);
  }
  if (options.expected.includes("e2e-fixtures")) {
    await checkE2EFixtures(baseline);
  }
  if (options.expectNoTransactions) {
    await checkNoTransactions();
  }
  await checkAbsence(baseline);

  if (failures.length > 0) {
    console.error(`check-v2-seed-tiers: FAILED (${failures.length}/${checks} checks)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(`check-v2-seed-tiers: OK (${checks} checks)`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `check-v2-seed-tiers: FAILED (${error instanceof Error ? error.message : String(error)})`,
    );
    console.error(USAGE);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
