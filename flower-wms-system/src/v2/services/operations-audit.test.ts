import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../../generated/prisma-v2/client";
import { evaluateMigrationState } from "../domain/system-health";
import { collectDataQualityIssues } from "./data-quality";
import { listAuditActions, listV2AuditEvents } from "./audit-query";
import { loadSetupChecklist } from "./setup-checklist";
import { getV2SystemHealth } from "./system-health";

/**
 * Run through the managed database harness:
 *   npx tsx src/v2/services/operations-audit.test.ts
 *
 * Business Sprint 2 P2: data quality must find crafted anomalies without
 * mutating them, the trial checklist must reflect V2 master/order data, system
 * health must read V2 migrations, and the audit query must filter/paginate and
 * summarize snapshots while respecting store scope.
 */

loadEnv({ quiet: true });
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8).toUpperCase();

const storageConfig = {
  driver: "local" as const,
  enableOssUpload: false,
  enableLegacyUploads: false,
  bucket: "",
  region: "",
  endpoint: "",
  internalEndpoint: "",
  uploadEndpoint: "",
  publicBaseUrl: "",
  objectPrefix: "",
  accessKeyId: "",
  accessKeySecret: "",
  uploadMaxSizeMb: 3,
  uploadAllowedMimeTypes: ["image/jpeg"],
  uploadAllowedExtensions: ["jpg"],
  uploadAllowSvg: false,
  imageStorageMode: "object_key" as const,
  imageReturnPublicUrl: false,
  blockLocalhostImageUrl: true,
  normalizeLocalhostUploads: false,
};

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 operations/audit DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `sprint2-ops-${marker.toLowerCase()}`, name: "P2 运营检查测试租户" },
    });
    const otherTenant = await db.tenant.create({
      data: { slug: `sprint2-ops-other-${marker.toLowerCase()}`, name: "P2 运营检查他租户" },
    });
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "P2 运营检查测试店" },
    });
    const otherStore = await db.store.create({
      data: { tenantId: otherTenant.id, code: "MAIN", name: "P2 他租户店" },
    });
    const location = await db.inventoryLocation.create({
      data: { storeId: store.id, code: "STOCK", kind: "WAREHOUSE" },
    });
    await db.inventoryLocation.create({
      data: { storeId: otherStore.id, code: "STOCK", kind: "WAREHOUSE" },
    });

    const material = await db.material.create({
      data: {
        tenantId: tenant.id,
        code: `M-${marker}`,
        name: "P2 无成本花材",
        kind: "FLOWER",
        baseUnit: "支",
        safetyStockThreshold: 10,
      },
    });
    const otherMaterial = await db.material.create({
      data: {
        tenantId: otherTenant.id,
        code: `M-${marker}`,
        name: "P2 他租户花材",
        kind: "FLOWER",
        baseUnit: "支",
        standardUnitCost: 9,
      },
    });

    // Active product with an active SKU but no recipe.
    const product = await db.product.create({
      data: { tenantId: tenant.id, code: `P-${marker}`, name: "P2 缺配方商品", active: true },
    });
    const sku = await db.productSku.create({
      data: { productId: product.id, code: `S-${marker}`, name: "缺配方 SKU", price: 100, active: true },
    });
    // Published recipe version with no lines.
    const productWithEmptyRecipe = await db.product.create({
      data: { tenantId: tenant.id, code: `P2-${marker}`, name: "P2 空配方商品", active: true },
    });
    const skuWithEmptyRecipe = await db.productSku.create({
      data: {
        productId: productWithEmptyRecipe.id,
        code: `S2-${marker}`,
        name: "空配方 SKU",
        price: 100,
        active: true,
      },
    });
    const recipe = await db.recipe.create({ data: { skuId: skuWithEmptyRecipe.id } });
    await db.recipeVersion.create({
      data: { recipeId: recipe.id, versionNo: 1, state: "PUBLISHED", publishedAt: new Date() },
    });

    // Stock rows used by the loss/stocktake checks. The database invariants
    // reject negative balances and non-positive loss/stocktake quantities, so
    // the read-only scan must be exercised with anomalies that can legally
    // exist (expired stock, missing recipe, zero order/purchase quantities).
    const batch = await db.inventoryBatch.create({
      data: {
        storeId: store.id,
        materialId: material.id,
        batchNo: `BATCH-${marker}`,
        unitCost: 1,
        costEstimated: false,
      },
    });
    await db.batchBalance.create({
      data: { batchId: batch.id, locationId: location.id, onHandQty: 10, frozenQty: 0 },
    });
    const expiredBatch = await db.inventoryBatch.create({
      data: {
        storeId: store.id,
        materialId: material.id,
        batchNo: `EXP-${marker}`,
        unitCost: 2,
        usableUntil: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await db.batchBalance.create({
      data: { batchId: expiredBatch.id, locationId: location.id, onHandQty: 5, frozenQty: 0 },
    });
    // Other tenant expired stock must not appear in this tenant's result.
    const otherLocation = await db.inventoryLocation.findFirstOrThrow({
      where: { storeId: otherStore.id },
    });
    const otherBatch = await db.inventoryBatch.create({
      data: {
        storeId: otherStore.id,
        materialId: otherMaterial.id,
        batchNo: `OTHER-${marker}`,
        unitCost: 9,
        usableUntil: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await db.batchBalance.create({
      data: { batchId: otherBatch.id, locationId: otherLocation.id, onHandQty: 4, frozenQty: 0 },
    });

    // The data-quality scan keeps a defensive negative-quantity check, but the
    // database must reject such rows before they ever reach a production table.
    // Assert the invariant here instead of inserting an impossible fixture.
    await assert.rejects(
      db.batchBalance.create({
        data: { batchId: batch.id, locationId: location.id, onHandQty: -2, frozenQty: 0 },
      }),
      /BatchBalance_nonnegative_qty_chk/,
    );
    await assert.rejects(
      db.lossRecord.create({
        data: {
          storeId: store.id,
          batchId: batch.id,
          materialId: material.id,
          locationId: location.id,
          reason: "OTHER",
          quantity: 0,
        },
      }),
      /LossRecord_positive_qty_chk/,
    );

    // Invalid order item quantity and a delivered order without a snapshot.
    const badOrder = await db.order.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        number: `BAD-ORD-${marker}`,
        createdVia: "STAFF_PORTAL",
        sourceChannel: "test",
        commercialState: "DRAFT",
        items: {
          create: { kind: "STANDARD", skuId: sku.id, nameSnapshot: "缺配方商品", quantity: 0, unitPrice: 0 },
        },
      },
      include: { items: true },
    });
    const missingSnapshotOrder = await db.order.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        number: `DEL-${marker}`,
        createdVia: "STAFF_PORTAL",
        sourceChannel: "test",
        commercialState: "CONFIRMED",
        fulfillmentState: "DELIVERED",
      },
    });

    // Invalid purchase quantity.
    const supplier = await db.supplier.create({
      data: { tenantId: tenant.id, code: `SUP-${marker}`, name: "P2 运营供应商" },
    });
    const purchase = await db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        supplierId: supplier.id,
        number: `PO-${marker}`,
        state: "DRAFT",
        lines: {
          create: {
            materialId: material.id,
            orderedQty: 0,
            purchaseUnit: "支",
            expectedBaseQty: 0,
            unitPrice: 1,
          },
        },
      },
      include: { lines: true },
    });

    // Boundary-valid loss and stocktake rows. Non-positive loss quantities and
    // negative counts are rejected by the database, so they cannot be reported
    // by the read-only scan; valid rows must not be misreported instead.
    const validLoss = await db.lossRecord.create({
      data: {
        storeId: store.id,
        batchId: batch.id,
        materialId: material.id,
        locationId: location.id,
        reason: "OTHER",
        quantity: 1,
      },
    });
    const stocktake = await db.stocktake.create({ data: { storeId: store.id, state: "DRAFT" } });
    await assert.rejects(
      db.stocktakeLine.create({
        data: {
          stocktakeId: stocktake.id,
          batchId: batch.id,
          locationId: location.id,
          countedQty: -1,
          recordedQty: 0,
        },
      }),
      /StocktakeLine_nonnegative_count_chk/,
    );
    const validStocktakeLine = await db.stocktakeLine.create({
      data: {
        stocktakeId: stocktake.id,
        batchId: batch.id,
        locationId: location.id,
        countedQty: 0,
        recordedQty: 0,
      },
    });

    const scope = { tenantId: tenant.id, storeId: store.id };
    const quality = await collectDataQualityIssues(db, scope, {
      now: new Date("2026-11-06T04:00:00.000Z"),
    });
    const ids = new Set(quality.issues.map((issue) => issue.entityId));
    assert.equal(ids.has(sku.id), true, "missing recipe issue");
    assert.equal(ids.has(badOrder.items[0]!.id), true, "illegal order item");
    assert.equal(ids.has(missingSnapshotOrder.id), true, "delivered without snapshot");
    assert.equal(ids.has(purchase.lines[0]!.id), true, "illegal purchase quantity");
    assert.equal(ids.has(expiredBatch.id), true, "expired stock");
    assert.equal(quality.issues.some((issue) => issue.entityType === "RecipeVersion"), true);
    assert.equal(quality.issues.some((issue) => issue.entityId === validLoss.id), false);
    assert.equal(quality.issues.some((issue) => issue.entityId === validStocktakeLine.id), false);
    assert.equal(quality.issues.some((issue) => issue.entityId === otherBatch.id), false);
    assert.equal(quality.summary.criticalCount > 0, true);

    // Read-only: the expired batch still holds its stock after the check.
    const stillExpired = await db.inventoryBatch.findUniqueOrThrow({ where: { id: expiredBatch.id } });
    const stillHeld = await db.batchBalance.findMany({ where: { batchId: stillExpired.id } });
    assert.equal(stillHeld.reduce((sum, balance) => sum + Number(balance.onHandQty), 0), 5);

    const setup = await loadSetupChecklist(db, scope, new Date("2026-11-06T04:00:00.000Z"));
    assert.equal(setup.stats.activeSkuWithoutRecipeCount, 1);
    assert.equal(setup.stats.publishedRecipeVersionWithoutLinesCount, 1);
    assert.equal(setup.stats.tenantCount, 1);
    assert.equal(setup.stats.storeCount, 1);
    assert.equal(setup.stats.warehouseLocationCount, 1);
    assert.equal(setup.stats.deliveredWithoutSnapshotCount, 1);
    assert.equal(setup.stats.criticalDataQualityCount, quality.summary.criticalCount);
    assert.equal(setup.result.sections.length, 6);
    assert.equal(setup.result.summary.overallStatus, "CRITICAL");

    // Audit query: current store + tenant-level only, filter and pagination.
    const staff = await db.staffUser.create({
      data: { username: `p2-audit-${marker.toLowerCase()}`, passwordHash: "not-a-real-hash", displayName: "P2 审计员" },
    });
    const currentAudit = await db.auditEvent.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        actorStaffId: staff.id,
        action: `P2_CURRENT_${marker}`,
        entityType: "Order",
        entityId: missingSnapshotOrder.id,
        beforeSnapshot: { state: "CONFIRMED", quantity: 1 },
        afterSnapshot: { state: "DELIVERED", quantity: 1, note: "P2" },
        occurredAt: new Date("2026-11-05T03:00:00.000Z"),
      },
    });
    const tenantAudit = await db.auditEvent.create({
      data: {
        tenantId: tenant.id,
        action: `P2_TENANT_${marker}`,
        entityType: "Tenant",
        entityId: tenant.id,
        afterSnapshot: { note: "tenant level" },
        occurredAt: new Date("2026-11-05T04:00:00.000Z"),
      },
    });
    assert.equal(tenantAudit.storeId, null);

    await db.auditEvent.create({
      data: {
        tenantId: otherTenant.id,
        storeId: otherStore.id,
        action: `P2_OTHER_${marker}`,
        entityType: "Order",
        entityId: "other",
        occurredAt: new Date("2026-11-05T05:00:00.000Z"),
      },
    });

    const audit = await listV2AuditEvents(db, scope, { pageSize: 1 });
    assert.equal(audit.pagination.total, 2);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0]!.action, `P2_TENANT_${marker}`);

    const filtered = await listV2AuditEvents(db, scope, { action: `CURRENT_${marker}` });
    assert.equal(filtered.pagination.total, 1);
    assert.equal(filtered.rows[0]!.id, currentAudit.id);
    assert.equal(filtered.rows[0]!.actorName, "P2 审计员");
    assert.equal(filtered.rows[0]!.change.changes.length >= 2, true);
    assert.match(filtered.rows[0]!.change.summary, /state/);

    const actions = await listAuditActions(db, scope);
    assert.deepEqual(actions, [`P2_CURRENT_${marker}`, `P2_TENANT_${marker}`]);

    const localMigrations = (await readdir(join(process.cwd(), "prisma", "v2", "migrations"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    const health = await getV2SystemHealth(db, {
      env: {
        NODE_ENV: "test",
        V2_DATABASE_URL: "postgresql://managed/test",
        AUTH_SECRET: "test-secret",
        NEXTAUTH_URL: "http://127.0.0.1:3000",
      },
      now: new Date("2026-11-06T04:00:00.000Z"),
      checkDisk: false,
      storageConfig,
      localMigrationNames: localMigrations,
    });
    assert.equal(health.checks.find((check) => check.key === "v2_database")?.status, "OK");
    const migrationCheck = health.checks.find((check) => check.key === "v2_migrations");
    assert.equal(migrationCheck?.status, "OK");
    assert.equal(health.migrationState?.pending.length, 0);
    assert.equal(health.migrationState?.failed.length, 0);
    assert.equal(health.checks.find((check) => check.key === "environment")?.status, "OK");
    assert.equal(health.checks.find((check) => check.key === "storage")?.status, "WARNING");
    // No check message may echo a datasource URL/credential even when probes fail.
    assert.equal(
      health.checks.some((check) => /postgres(?:ql)?:\/\//.test(check.message)),
      false,
      "system health leaked a connection string",
    );

    const missingEnvHealth = await getV2SystemHealth(db, {
      env: { NODE_ENV: "test" },
      now: new Date("2026-11-06T04:00:00.000Z"),
      checkDisk: false,
      storageConfig,
      localMigrationNames: localMigrations,
    });
    assert.equal(missingEnvHealth.checks.find((check) => check.key === "environment")?.status, "WARNING");

    // Pure migration helper agrees with the real database state.
    const applied = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC
    `;
    const evaluated = evaluateMigrationState(localMigrations, applied);
    assert.equal(evaluated.status, "OK");
    assert.equal(evaluated.latestApplied, localMigrations[localMigrations.length - 1] ?? null);

    console.log("v2 operations/audit DB test passed");
  } finally {
    await db.$disconnect();
  }
}

runDatabaseTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
