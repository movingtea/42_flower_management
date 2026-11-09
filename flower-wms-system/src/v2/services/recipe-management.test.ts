import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MaterialKind,
  OrderEntry,
  OrderItemKind,
  PrismaClient,
  RecipeState,
} from "../../generated/prisma-v2/client";
import {
  publishRecipeVersion,
  retireRecipeVersion,
  saveRecipeDraft,
} from "./recipe-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let otherTenantId: string | undefined;

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 recipe management DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `phase1-recipe-${marker}`, name: "配方管理测试租户" },
    });
    tenantId = tenant.id;
    const otherTenant = await db.tenant.create({
      data: { slug: `phase1-recipe-other-${marker}`, name: "配方管理他租户" },
    });
    otherTenantId = otherTenant.id;
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "配方管理测试店" },
    });
    const otherStore = await db.store.create({
      data: { tenantId: otherTenant.id, code: "MAIN", name: "配方管理他租户店" },
    });
    const materialA1 = await db.material.create({
      data: {
        tenantId: tenant.id,
        code: `REC-MAT-A1-${marker}`,
        name: "配方测试花材",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 1,
      },
    });
    const materialA2 = await db.material.create({
      data: {
        tenantId: tenant.id,
        code: `REC-MAT-A2-${marker}`,
        name: "配方测试包装",
        kind: MaterialKind.PACKAGING,
        baseUnit: "张",
        quantityScale: 0,
      },
    });
    const materialB = await db.material.create({
      data: {
        tenantId: otherTenant.id,
        code: `REC-MAT-B-${marker}`,
        name: "他租户配方物料",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 1,
      },
    });

    const skuA = await createSkuFixture(db, tenant.id, `A-${marker}`);
    const skuB = await createSkuFixture(db, otherTenant.id, `B-${marker}`);

    const scope = {
      tenantId: tenant.id,
      storeId: store.id,
      actorStaffId: "staff-recipe-test",
    };
    const otherScope = {
      tenantId: otherTenant.id,
      storeId: otherStore.id,
      actorStaffId: "staff-recipe-other-test",
    };

    // Draft line validation.
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, { skuId: skuA.id, lines: [] }),
      ),
      /配方至少需要一项物料/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [
            { materialId: materialA1.id, quantity: 1 },
            { materialId: materialA1.id, quantity: 2 },
          ],
        }),
      ),
      /同一物料不能在配方中重复添加/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [{ materialId: materialA1.id, quantity: 0 }],
        }),
      ),
      /用量必须大于零/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [{ materialId: materialA1.id, quantity: -1 }],
        }),
      ),
      /用量必须大于零/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [{ materialId: materialA1.id, quantity: 1.25 }],
        }),
      ),
      /用量不符合物料计量精度/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [{ materialId: materialB.id, quantity: 1 }],
        }),
      ),
      /配方物料不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, otherScope, {
          skuId: skuA.id,
          lines: [{ materialId: materialA1.id, quantity: 1 }],
        }),
      ),
      /SKU 不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          lines: [{ materialId: materialA1.id, quantity: 1 }],
          effectiveAt: new Date("invalid"),
        }),
      ),
      /配方生效时间无效/,
    );

    // First draft gets versionNo 1; a second draft without versionId gets versionNo 2.
    const effectiveAt = new Date("2026-11-10T00:00:00.000Z");
    const draft1 = await db.$transaction((tx) =>
      saveRecipeDraft(tx, scope, {
        skuId: skuA.id,
        lines: [
          { materialId: materialA1.id, quantity: 1.5 },
          { materialId: materialA2.id, quantity: 2 },
        ],
        effectiveAt,
      }),
    );
    assert.equal(draft1.versionNo, 1);
    const version1 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft1.versionId },
      include: { lines: true },
    });
    assert.equal(version1.state, RecipeState.DRAFT);
    assert.equal(version1.lines.length, 2);
    assert.equal(version1.effectiveAt?.toISOString(), effectiveAt.toISOString());

    const draft2 = await db.$transaction((tx) =>
      saveRecipeDraft(tx, scope, {
        skuId: skuA.id,
        lines: [{ materialId: materialA1.id, quantity: 2 }],
      }),
    );
    assert.equal(draft2.versionNo, 2);

    // Editing a DRAFT keeps versionNo and replaces its lines atomically.
    const edited = await db.$transaction((tx) =>
      saveRecipeDraft(tx, scope, {
        skuId: skuA.id,
        versionId: draft2.versionId,
        lines: [
          { materialId: materialA1.id, quantity: 3 },
          { materialId: materialA2.id, quantity: 4 },
        ],
        effectiveAt: null,
      }),
    );
    assert.equal(edited.versionNo, 2);
    const version2 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft2.versionId },
      include: { lines: true },
    });
    assert.equal(version2.state, RecipeState.DRAFT);
    assert.equal(version2.effectiveAt, null);
    assert.equal(version2.lines.length, 2);
    assert.deepEqual(
      version2.lines
        .map((line) => ({ materialId: line.materialId, quantity: Number(line.plannedQty) }))
        .sort((left, right) => left.materialId.localeCompare(right.materialId)),
      [
        { materialId: materialA1.id, quantity: 3 },
        { materialId: materialA2.id, quantity: 4 },
      ].sort((left, right) => left.materialId.localeCompare(right.materialId)),
    );

    // Publishing the first draft marks it PUBLISHED with publishedAt/effectiveAt.
    const publish1 = await db.$transaction((tx) =>
      publishRecipeVersion(tx, scope, draft1.versionId),
    );
    assert.deepEqual(publish1.retiredVersionIds, []);
    const published1 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft1.versionId },
    });
    assert.equal(published1.state, RecipeState.PUBLISHED);
    assert.ok(published1.publishedAt);
    assert.equal(published1.effectiveAt?.toISOString(), effectiveAt.toISOString());

    // A published version can never be overwritten.
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          versionId: draft1.versionId,
          lines: [{ materialId: materialA1.id, quantity: 9 }],
        }),
      ),
      /已发布或已停用的配方版本不可修改，请新建草稿/,
    );

    // Publishing v2 retires v1 but keeps v1's persisted lines untouched.
    const version1LinesBefore = await db.recipeLine.findMany({
      where: { versionId: draft1.versionId },
      orderBy: { id: "asc" },
    });
    const publish2 = await db.$transaction((tx) =>
      publishRecipeVersion(tx, scope, draft2.versionId),
    );
    assert.deepEqual(publish2.retiredVersionIds, [draft1.versionId]);
    const retired1 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft1.versionId },
    });
    assert.equal(retired1.state, RecipeState.RETIRED);
    const version1LinesAfter = await db.recipeLine.findMany({
      where: { versionId: draft1.versionId },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      version1LinesAfter.map((line) => ({
        id: line.id,
        materialId: line.materialId,
        quantity: Number(line.plannedQty),
      })),
      version1LinesBefore.map((line) => ({
        id: line.id,
        materialId: line.materialId,
        quantity: Number(line.plannedQty),
      })),
    );
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, draft2.versionId)),
      /只有草稿配方版本可以发布/,
    );

    // A historical order item keeps pointing at the version it was sold with.
    const order = await db.order.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        number: `ORD-REC-${marker}`,
        createdVia: OrderEntry.STAFF_PORTAL,
        sourceChannel: "TEST",
      },
    });
    const orderItem = await db.orderItem.create({
      data: {
        orderId: order.id,
        kind: OrderItemKind.STANDARD,
        skuId: skuA.id,
        recipeVersionId: draft2.versionId,
        nameSnapshot: "配方历史订单商品",
        quantity: 1,
        unitPrice: 88,
      },
    });

    const draft3 = await db.$transaction((tx) =>
      saveRecipeDraft(tx, scope, {
        skuId: skuA.id,
        lines: [{ materialId: materialA1.id, quantity: 5 }],
      }),
    );
    assert.equal(draft3.versionNo, 3);
    const publish3 = await db.$transaction((tx) =>
      publishRecipeVersion(tx, scope, draft3.versionId),
    );
    assert.deepEqual(publish3.retiredVersionIds, [draft2.versionId]);
    const historicalItem = await db.orderItem.findUniqueOrThrow({
      where: { id: orderItem.id },
    });
    assert.equal(historicalItem.recipeVersionId, draft2.versionId);
    const retired2 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft2.versionId },
    });
    assert.equal(retired2.state, RecipeState.RETIRED);
    assert.equal(
      await db.recipeLine.count({ where: { versionId: draft2.versionId } }),
      2,
    );

    // Only a PUBLISHED version can be retired, and retired versions stay immutable.
    const retired3 = await db.$transaction((tx) =>
      retireRecipeVersion(tx, scope, draft3.versionId),
    );
    assert.equal(retired3.versionNo, 3);
    const version3 = await db.recipeVersion.findUniqueOrThrow({
      where: { id: draft3.versionId },
    });
    assert.equal(version3.state, RecipeState.RETIRED);
    await assert.rejects(
      db.$transaction((tx) => retireRecipeVersion(tx, scope, draft3.versionId)),
      /只有已发布的配方版本可以停用/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, scope, {
          skuId: skuA.id,
          versionId: draft3.versionId,
          lines: [{ materialId: materialA1.id, quantity: 1 }],
        }),
      ),
      /已发布或已停用的配方版本不可修改，请新建草稿/,
    );

    // Cross-tenant version access is rejected for read/write lifecycle actions.
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, otherScope, draft3.versionId)),
      /配方版本不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) => retireRecipeVersion(tx, otherScope, draft3.versionId)),
      /配方版本不存在或不属于当前租户/,
    );
    await assert.rejects(
      db.$transaction((tx) =>
        saveRecipeDraft(tx, otherScope, {
          skuId: skuB.id,
          versionId: draft3.versionId,
          lines: [{ materialId: materialA1.id, quantity: 1 }],
        }),
      ),
      /配方版本不存在或不属于当前租户/,
    );

    // Publish re-reads stored rows, so malformed rows cannot slip through.
    const recipeA = await db.recipe.findUniqueOrThrow({ where: { skuId: skuA.id } });
    const emptyVersion = await db.recipeVersion.create({
      data: { recipeId: recipeA.id, versionNo: 100, state: RecipeState.DRAFT },
    });
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, emptyVersion.id)),
      /配方至少需要一项物料/,
    );
    const duplicateVersion = await db.recipeVersion.create({
      data: {
        recipeId: recipeA.id,
        versionNo: 101,
        state: RecipeState.DRAFT,
        lines: {
          create: [
            { materialId: materialA1.id, plannedQty: 1.5 },
            { materialId: materialA1.id, plannedQty: 2.5 },
          ],
        },
      },
    });
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, duplicateVersion.id)),
      /同一物料不能在配方中重复添加/,
    );
    const zeroVersion = await db.recipeVersion.create({
      data: {
        recipeId: recipeA.id,
        versionNo: 102,
        state: RecipeState.DRAFT,
        lines: { create: { materialId: materialA1.id, plannedQty: 0 } },
      },
    });
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, zeroVersion.id)),
      /用量必须大于零/,
    );
    const precisionVersion = await db.recipeVersion.create({
      data: {
        recipeId: recipeA.id,
        versionNo: 103,
        state: RecipeState.DRAFT,
        lines: { create: { materialId: materialA1.id, plannedQty: 1.25 } },
      },
    });
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, precisionVersion.id)),
      /用量不符合物料计量精度/,
    );
    const foreignVersion = await db.recipeVersion.create({
      data: {
        recipeId: recipeA.id,
        versionNo: 104,
        state: RecipeState.DRAFT,
        lines: { create: { materialId: materialB.id, plannedQty: 1 } },
      },
    });
    await assert.rejects(
      db.$transaction((tx) => publishRecipeVersion(tx, scope, foreignVersion.id)),
      /配方物料不存在或不属于当前租户/,
    );
    const stillDraft = await db.recipeVersion.findUniqueOrThrow({
      where: { id: foreignVersion.id },
    });
    assert.equal(stillDraft.state, RecipeState.DRAFT);

    // Recipe lifecycle actions are audited with the caller's tenant/store/actor scope.
    const audits = await db.auditEvent.findMany({
      where: {
        tenantId: tenant.id,
        action: {
          in: [
            "RECIPE_DRAFT_SAVED",
            "RECIPE_VERSION_PUBLISHED",
            "RECIPE_VERSION_RETIRED",
          ],
        },
      },
      select: { action: true, storeId: true, actorStaffId: true },
    });
    const actions = new Set(audits.map((event) => event.action));
    for (const expected of [
      "RECIPE_DRAFT_SAVED",
      "RECIPE_VERSION_PUBLISHED",
      "RECIPE_VERSION_RETIRED",
    ]) {
      assert.ok(actions.has(expected), `missing audit event ${expected}`);
    }
    assert.ok(
      audits.every(
        (event) =>
          event.storeId === store.id && event.actorStaffId === "staff-recipe-test",
      ),
    );

    console.log("v2 recipe management DB test passed");
  } finally {
    await cleanup(db);
    await db.$disconnect();
  }
}

async function createSkuFixture(
  db: PrismaClient,
  tenantIdValue: string,
  suffix: string,
) {
  const product = await db.product.create({
    data: {
      tenantId: tenantIdValue,
      code: `REC-PROD-${suffix}`,
      name: `配方测试商品 ${suffix}`,
    },
  });
  const sku = await db.productSku.create({
    data: {
      productId: product.id,
      code: `REC-SKU-${suffix}`,
      name: "配方标准款",
      price: 99,
      estimatedConsumableCost: 1,
      estimatedLaborCost: 2,
      active: true,
    },
  });
  await db.product.update({
    where: { id: product.id },
    data: { active: true, defaultSkuId: sku.id },
  });
  return sku;
}

async function cleanup(db: PrismaClient): Promise<void> {
  const tenantIds = [tenantId, otherTenantId].filter(
    (id): id is string => Boolean(id),
  );
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.recipeLine.deleteMany({
    where: { version: { recipe: { sku: { product: tenants } } } },
  });
  await db.recipeVersion.deleteMany({
    where: { recipe: { sku: { product: tenants } } },
  });
  await db.recipe.deleteMany({ where: { sku: { product: tenants } } });
  await db.product.updateMany({ where: tenants, data: { defaultSkuId: null } });
  await db.productSku.deleteMany({ where: { product: tenants } });
  await db.product.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

runDatabaseTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
