import assert from "node:assert/strict";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MaterialKind,
  PrismaClient,
  RecipeState,
  SampleState,
} from "../../generated/prisma-v2/client";
import {
  convertSampleToSku,
  convertSamplesToProduct,
  getSkuListingCheck,
} from "./sample-conversion";
import { setProductActive, setSkuActive } from "./catalog-management";
import { publishRecipeVersion } from "./recipe-management";
import type { SampleScope } from "./sample-management";
import { getSampleReport } from "./sample-reporting";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);
let tenantId: string | undefined;

async function cleanup(db: PrismaClient): Promise<void> {
  if (!tenantId) return;
  const tenants = { tenantId };
  await db.auditEvent.deleteMany({ where: tenants });
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
  await db.sampleMaterial.deleteMany({ where: { sample: tenants } });
  await db.sample.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: tenantId } });
}

async function makeSample(
  db: PrismaClient,
  input: { code: string; name: string; flowerId: string; flowerQty: number; packagingId: string; packagingQty: number },
) {
  return db.sample.create({
    data: {
      tenantId: tenantId!,
      code: input.code,
      name: input.name,
      state: SampleState.READY,
      targetMarginRate: "0.5000",
      materials: {
        create: [
          { materialId: input.flowerId, quantity: input.flowerQty },
          { materialId: input.packagingId, quantity: input.packagingQty },
        ],
      },
    },
  });
}

async function run(): Promise<void> {
  if (!connectionString) {
    console.log("v2 sample conversion DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `sprint4-convert-${marker}`, name: "Sprint 4 转 SKU 测试租户" },
    });
    tenantId = tenant.id;
    const store = await db.store.create({
      data: { tenantId, code: "MAIN", name: "Sprint 4 转 SKU 测试店" },
    });
    const flower = await db.material.create({
      data: {
        tenantId,
        code: `S4-CONV-ROSE-${marker}`,
        name: "转 SKU 红玫瑰",
        kind: MaterialKind.FLOWER,
        baseUnit: "支",
        quantityScale: 0,
        standardUnitCost: "2.0000",
        standardUsableRate: "0.5000",
        active: true,
      },
    });
    const packaging = await db.material.create({
      data: {
        tenantId,
        code: `S4-CONV-WRAP-${marker}`,
        name: "转 SKU 包装纸",
        kind: MaterialKind.PACKAGING,
        baseUnit: "张",
        quantityScale: 0,
        standardUnitCost: "5.0000",
        active: true,
      },
    });
    const sample1 = await makeSample(db, {
      code: `SMP-CONV-1-${marker}`,
      name: "转 SKU 样品 1",
      flowerId: flower.id,
      flowerQty: 10,
      packagingId: packaging.id,
      packagingQty: 2,
    });
    const sample2 = await makeSample(db, {
      code: `SMP-CONV-2-${marker}`,
      name: "转 SKU 样品 2",
      flowerId: flower.id,
      flowerQty: 4,
      packagingId: packaging.id,
      packagingQty: 1,
    });
    const scope: SampleScope = { tenantId, storeId: store.id, actorStaffId: "staff-conversion-test" };

    const converted = await db.$transaction((tx) => convertSampleToSku(tx, scope, {
      sampleId: sample1.id,
      newProductName: "Sprint 4 转 SKU 商品",
      skuName: "标准款",
      targetMarginRate: 0.5,
      laborCost: 10,
    }), { timeout: 30_000 });
    assert.match(converted.skuCode, /^SKU-\d{8}-/);
    assert.equal(converted.materialCost, 20);
    assert.equal(converted.packagingCost, 10);
    assert.equal(converted.laborCost, 10);
    assert.equal(converted.price, 80);
    const sku = await db.productSku.findUniqueOrThrow({
      where: { id: converted.skuId },
      include: { product: true, recipe: { include: { versions: { include: { lines: true } } } } },
    });
    assert.equal(sku.product.active, false);
    assert.equal(sku.active, false);
    assert.equal(sku.sourceSampleId, sample1.id);
    const recipeVersion = sku.recipe?.versions[0];
    assert.ok(recipeVersion);
    assert.equal(recipeVersion.state, RecipeState.DRAFT);
    assert.equal(recipeVersion.lines.length, 2);

    const listingBefore = await db.$transaction((tx) => getSkuListingCheck(tx, scope, sku.id));
    assert.equal(listingBefore.ready, false);
    assert.equal(listingBefore.hasDraftRecipe, true);
    assert.equal(listingBefore.hasPublishedRecipe, false);

    // One sample can generate a second, independently priced and configured SKU.
    const variant = await db.$transaction((tx) => convertSampleToSku(tx, scope, {
      sampleId: sample1.id,
      productId: sku.productId,
      skuName: "小款变体",
      lines: [
        { materialId: flower.id, quantity: 5 },
        { materialId: packaging.id, quantity: 1 },
      ],
      targetMarginRate: 0.4,
      laborCost: 5,
    }), { timeout: 30_000 });
    assert.equal(variant.productId, sku.productId);
    assert.notEqual(variant.skuId, sku.id);
    assert.equal(variant.materialCost, 10);
    assert.equal(variant.packagingCost, 5);
    assert.equal(variant.price, 33.33);

    const batchConverted = await db.$transaction((tx) => convertSamplesToProduct(tx, scope, {
      sampleIds: [sample1.id, sample2.id],
      productId: sku.productId,
      skuNamePrefix: "批量",
      targetMarginRate: 0.5,
      laborCost: 0,
    }), { timeout: 30_000 });
    assert.equal(batchConverted.length, 2);
    assert.ok(batchConverted.every((result) => result.productId === sku.productId));
    const productSkus = await db.productSku.findMany({ where: { productId: sku.productId } });
    assert.equal(productSkus.length, 4);

    const report = await getSampleReport(db, { tenantId, storeId: store.id });
    assert.equal(report.summary.sampleCount, 2);
    assert.equal(report.summary.convertedSampleCount, 2);
    assert.equal(report.summary.conversionRate, 1);
    assert.equal(report.summary.sampleSkuCount, 4);
    assert.equal(report.summary.planCount, 0);

    // Publish the standard recipe, enable the SKU and product, then the listing check passes.
    await db.$transaction((tx) => publishRecipeVersion(tx, scope, recipeVersion.id));
    await db.$transaction((tx) => setSkuActive(tx, scope, sku.id, true));
    await db.$transaction((tx) => setProductActive(tx, scope, sku.productId, true));
    const listingAfter = await db.$transaction((tx) => getSkuListingCheck(tx, scope, sku.id));
    assert.equal(listingAfter.hasPublishedRecipe, true);
    assert.equal(listingAfter.active, true);
    assert.equal(listingAfter.ready, true);

    // A draft sample cannot be converted.
    await db.sample.update({ where: { id: sample2.id }, data: { state: SampleState.DRAFT } });
    await assert.rejects(
      db.$transaction((tx) => convertSampleToSku(tx, scope, {
        sampleId: sample2.id,
        productId: sku.productId,
        skuName: "草稿样品转 SKU",
        targetMarginRate: 0.5,
      }), { timeout: 30_000 }),
      /只有已完成的样品/,
    );

    console.log("v2 sample conversion DB tests passed");
  } finally {
    try {
      await cleanup(db);
    } catch (error) {
      console.error("sample conversion cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
