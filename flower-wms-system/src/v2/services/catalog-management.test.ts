import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma-v2/client";
import {
  saveProduct,
  saveSku,
  setDefaultSku,
  setProductActive,
  setSkuActive,
} from "./catalog-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let otherTenantId: string | undefined;

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 catalog management DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `phase1-catalog-${marker}`, name: "目录管理测试租户" },
    });
    tenantId = tenant.id;
    const otherTenant = await db.tenant.create({
      data: { slug: `phase1-catalog-other-${marker}`, name: "目录管理他租户" },
    });
    otherTenantId = otherTenant.id;
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "目录管理测试店" },
    });
    const otherStore = await db.store.create({
      data: { tenantId: otherTenant.id, code: "MAIN", name: "目录管理他租户店" },
    });
    const sample = await db.sample.create({
      data: { tenantId: tenant.id, code: `SMP-${marker}`, name: "目录测试样品" },
    });
    const otherSample = await db.sample.create({
      data: { tenantId: otherTenant.id, code: `SMP-${marker}`, name: "他租户样品" },
    });

    const scope = {
      tenantId: tenant.id,
      storeId: store.id,
      actorStaffId: "staff-catalog-test",
    };
    const otherScope = {
      tenantId: otherTenant.id,
      storeId: otherStore.id,
      actorStaffId: "staff-catalog-other-test",
    };

    // Name and money validation.
    await assert.rejects(
      db.$transaction((tx) => saveProduct(tx, scope, { name: "   ", active: false })),
      /商品名称必填/,
    );
    await assert.rejects(
      db.$transaction((tx) => saveProduct(tx, scope, { name: "商".repeat(101), active: false })),
      /商品名称不能超过 100 个字符/,
    );

    // A product starts disabled; codes are system-generated and stable across edits.
    const product = await db.$transaction((tx) =>
      saveProduct(tx, scope, { name: "  测试花束  ", active: false }),
    );
    assert.match(product.code, /^PRD-\d{8}-[0-9a-fA-F-]{36}$/);
    assert.equal(product.active, false);
    assert.equal(product.defaultSkuId, null);

    await assert.rejects(
      db.$transaction((tx) => saveProduct(tx, scope, { name: "直接启用", active: true })),
      /商品启用前至少需要保留一个启用 SKU/,
    );

    // The first active SKU becomes the default; two SKUs may come from the same sample.
    const skuA = await db.$transaction((tx) =>
      saveSku(tx, scope, {
        productId: product.id,
        name: "标准款",
        price: 99,
        estimatedConsumableCost: 10.25,
        estimatedLaborCost: 20.5,
        active: true,
        sourceSampleId: sample.id,
      }),
    );
    assert.match(skuA.code, /^SKU-\d{8}-[0-9a-fA-F-]{36}$/);
    assert.equal(skuA.defaultSkuId, skuA.id);

    const skuB = await db.$transaction((tx) =>
      saveSku(tx, scope, {
        productId: product.id,
        name: "升级款",
        price: 129.99,
        estimatedConsumableCost: 12,
        estimatedLaborCost: 25,
        active: true,
        sourceSampleId: sample.id,
      }),
    );
    assert.notEqual(skuA.code, skuB.code);
    assert.equal(skuB.defaultSkuId, skuA.id);

    const storedProduct = await db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { defaultSku: true },
    });
    assert.equal(storedProduct.defaultSkuId, skuA.id);
    assert.equal(storedProduct.defaultSku?.productId, product.id);
    assert.equal(storedProduct.defaultSku?.active, true);

    // Edit name, then enable the product with the existing default.
    const renamed = await db.$transaction((tx) =>
      saveProduct(tx, scope, { id: product.id, name: "测试花束-改名", active: false }),
    );
    assert.equal(renamed.active, false);
    assert.equal(renamed.code, product.code);

    const updatedSku = await db.$transaction((tx) =>
      saveSku(tx, scope, {
        id: skuA.id,
        productId: product.id,
        name: "标准款-改名",
        price: 100,
        estimatedConsumableCost: 10.25,
        estimatedLaborCost: 20.5,
        active: true,
        sourceSampleId: sample.id,
      }),
    );
    assert.equal(updatedSku.code, skuA.code);
    assert.equal(updatedSku.defaultSkuId, skuA.id);

    const activated = await db.$transaction((tx) =>
      saveProduct(tx, scope, { id: product.id, name: "测试花束-改名", active: true }),
    );
    assert.equal(activated.active, true);
    assert.equal(activated.defaultSkuId, skuA.id);

    // A default must belong to this product and be active.
    const inactiveSku = await db.$transaction((tx) =>
      saveSku(tx, scope, {
        productId: product.id,
        name: "停用款",
        price: 50,
        estimatedConsumableCost: 1,
        estimatedLaborCost: 1,
        active: false,
      }),
    );
    const otherProduct = await db.$transaction((tx) =>
      saveProduct(tx, scope, { name: "另一个商品", active: false }),
    );
    const otherSku = await db.$transaction((tx) =>
      saveSku(tx, scope, {
        productId: otherProduct.id,
        name: "其他商品款",
        price: 60,
        estimatedConsumableCost: 1,
        estimatedLaborCost: 1,
        active: true,
      }),
    );
    await assert.rejects(
      db.$transaction((tx) => setDefaultSku(tx, scope, product.id, otherSku.id)),
      /默认 SKU 必须属于该商品且处于启用状态/,
    );
    await assert.rejects(
      db.$transaction((tx) => setDefaultSku(tx, scope, product.id, inactiveSku.id)),
      /默认 SKU 必须属于该商品且处于启用状态/,
    );

    const defaulted = await db.$transaction((tx) =>
      setDefaultSku(tx, scope, product.id, skuB.id),
    );
    assert.equal(defaulted.defaultSkuId, skuB.id);
    await db.$transaction((tx) => setDefaultSku(tx, scope, product.id, skuA.id));

    // Deactivating the default promotes the lowest-code remaining active SKU.
    const promoted = await db.$transaction((tx) => setSkuActive(tx, scope, skuA.id, false));
    assert.equal(promoted.active, false);
    assert.equal(promoted.defaultSkuId, skuB.id);
    const promotedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(promotedProduct.active, true);
    assert.equal(promotedProduct.defaultSkuId, skuB.id);

    // Deactivating the last active default deactivates the product and clears the default.
    const lastDeactivated = await db.$transaction((tx) =>
      setSkuActive(tx, scope, skuB.id, false),
    );
    assert.equal(lastDeactivated.defaultSkuId, null);
    const emptiedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(emptiedProduct.active, false);
    assert.equal(emptiedProduct.defaultSkuId, null);

    // An active product needs at least one active SKU and an active default.
    await assert.rejects(
      db.$transaction((tx) => setProductActive(tx, scope, product.id, true)),
      /商品启用前至少需要保留一个启用 SKU/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveProduct(tx, scope, { id: product.id, name: "测试花束-改名", active: true }),
      ),
      /商品启用前至少需要保留一个启用 SKU/,
    );

    // Reactivating an SKU restores the default; then the product can be enabled again.
    const reactivatedSku = await db.$transaction((tx) =>
      setSkuActive(tx, scope, skuB.id, true),
    );
    assert.equal(reactivatedSku.active, true);
    assert.equal(reactivatedSku.defaultSkuId, skuB.id);
    const reenabled = await db.$transaction((tx) =>
      setProductActive(tx, scope, product.id, true),
    );
    assert.equal(reenabled.active, true);
    assert.equal(reenabled.defaultSkuId, skuB.id);

    // Deactivating a product is allowed and keeps a valid active default.
    const productOff = await db.$transaction((tx) =>
      setProductActive(tx, scope, product.id, false),
    );
    assert.equal(productOff.active, false);
    assert.equal(productOff.defaultSkuId, skuB.id);
    const productOn = await db.$transaction((tx) =>
      setProductActive(tx, scope, product.id, true),
    );
    assert.equal(productOn.active, true);
    assert.equal(productOn.defaultSkuId, skuB.id);

    // activeSkuIds is exclusive: every other SKU of this product is disabled.
    const exclusive = await db.$transaction((tx) =>
      saveProduct(tx, scope, {
        id: product.id,
        name: "测试花束-改名",
        active: true,
        activeSkuIds: [skuB.id],
      }),
    );
    assert.equal(exclusive.active, true);
    assert.equal(exclusive.defaultSkuId, skuB.id);
    const disabledSku = await db.productSku.findUniqueOrThrow({ where: { id: skuA.id } });
    assert.equal(disabledSku.active, false);

    // Another product's SKU cannot be borrowed into activeSkuIds.
    await assert.rejects(
      db.$transaction((tx) =>
        saveProduct(tx, scope, {
          id: product.id,
          name: "测试花束-改名",
          active: true,
          activeSkuIds: [skuB.id, otherSku.id],
        }),
      ),
      /只能管理当前商品下的 SKU，不能包含其他商品的 SKU/,
    );
    // An active product cannot be left without an active default.
    await assert.rejects(
      db.$transaction((tx) =>
        saveProduct(tx, scope, {
          id: product.id,
          name: "测试花束-改名",
          active: true,
          activeSkuIds: [],
        }),
      ),
      /商品启用前至少需要保留一个启用 SKU/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveProduct(tx, scope, {
          id: product.id,
          name: "测试花束-改名",
          active: true,
          activeSkuIds: [skuB.id],
          defaultSkuId: skuA.id,
        }),
      ),
      /默认 SKU 必须属于该商品且处于启用状态/,
    );
    const rolledBack = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    assert.equal(rolledBack.active, true);
    assert.equal(rolledBack.defaultSkuId, skuB.id);

    // Cross-tenant product, SKU and sample access is rejected.
    await assert.rejects(
      db.$transaction((tx) =>
        saveProduct(tx, otherScope, { id: product.id, name: "跨租户", active: false }),
      ),
      /商品不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveSku(tx, otherScope, {
          productId: product.id,
          name: "跨租户 SKU",
          price: 1,
          estimatedConsumableCost: 0,
          estimatedLaborCost: 0,
          active: true,
        }),
      ),
      /商品不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveSku(tx, scope, {
          productId: product.id,
          name: "跨租户样品",
          price: 1,
          estimatedConsumableCost: 0,
          estimatedLaborCost: 0,
          active: false,
          sourceSampleId: otherSample.id,
        }),
      ),
      /来源样品不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) => setDefaultSku(tx, otherScope, product.id, skuB.id)),
      /商品不存在或不属于当前租户/,
    );

    // Money and SKU name validation.
    const validSku = {
      productId: product.id,
      name: "校验款",
      price: 1,
      estimatedConsumableCost: 0,
      estimatedLaborCost: 0,
      active: false,
    };
    await assert.rejects(
      db.$transaction((tx) => saveSku(tx, scope, { ...validSku, price: -1 })),
      /SKU 售价必须为非负有限数/,
    );
    await assert.rejects(
      db.$transaction((tx) => saveSku(tx, scope, { ...validSku, price: 1.234 })),
      /SKU 售价最多保留两位小数/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveSku(tx, scope, { ...validSku, estimatedConsumableCost: Number.NaN }),
      ),
      /预计耗材成本必须为非负有限数/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveSku(tx, scope, { ...validSku, estimatedLaborCost: Number.POSITIVE_INFINITY }),
      ),
      /预计人工成本必须为非负有限数/,
    );
    await assert.rejects(
      db.$transaction((tx) => saveSku(tx, scope, { ...validSku, name: "   " })),
      /SKU 规格名称必填/,
    );

    // Every catalog action is audited with the caller's tenant/store/actor scope.
    const audits = await db.auditEvent.findMany({
      where: { tenantId: tenant.id },
      select: { action: true, storeId: true, actorStaffId: true },
    });
    const actions = new Set(audits.map((event) => event.action));
    for (const expected of [
      "PRODUCT_CREATED",
      "PRODUCT_UPDATED",
      "PRODUCT_ACTIVATED",
      "PRODUCT_DEACTIVATED",
      "SKU_CREATED",
      "SKU_UPDATED",
      "SKU_ACTIVATED",
      "SKU_DEACTIVATED",
      "PRODUCT_DEFAULT_SKU_CHANGED",
    ]) {
      assert.ok(actions.has(expected), `missing audit event ${expected}`);
    }
    assert.ok(
      audits.every(
        (event) =>
          event.storeId === store.id && event.actorStaffId === "staff-catalog-test",
      ),
    );

    console.log("v2 catalog management DB test passed");
  } finally {
    await cleanup(db);
    await db.$disconnect();
  }
}

async function cleanup(db: PrismaClient): Promise<void> {
  const tenantIds = [tenantId, otherTenantId].filter(
    (id): id is string => Boolean(id),
  );
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.product.updateMany({ where: tenants, data: { defaultSkuId: null } });
  await db.productSku.deleteMany({ where: { product: tenants } });
  await db.product.deleteMany({ where: tenants });
  await db.sample.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

runDatabaseTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
