import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma-v2/client";
import { resolveReportRange } from "../../src/v2/domain/reporting";
import { loadDashboardData } from "../../src/v2/services/dashboard";
import { loadOverviewReport } from "../../src/v2/services/reporting";
import { collectDataQualityIssues } from "../../src/v2/services/data-quality";
import { loadSetupChecklist } from "../../src/v2/services/setup-checklist";
import { listAuditActions, listV2AuditEvents } from "../../src/v2/services/audit-query";
import { getV2SystemHealth } from "../../src/v2/services/system-health";

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Fixed audit timestamp so date-range and pagination assertions are deterministic. */
const AUDIT_DAY = "2026-11-05";
const AUDIT_OCCURRED_AT = new Date("2026-11-05T03:00:00.000Z");

/**
 * P2 operations smoke: the dashboard/report/setup/quality/audit/health service
 * path must work against the seeded V2 database without touching V1 rows.
 */
async function main() {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const currentAction = `SMOKE_AUDIT_${marker}`;
  const tenantAction = `SMOKE_AUDIT_TENANT_${marker}`;
  const otherStoreAction = `SMOKE_AUDIT_OTHER_${marker}`;

  const tenant = await db.tenant.create({
    data: { slug: `p2-smoke-${marker.toLowerCase()}`, name: "P2 冒烟租户" },
  });
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: "MAIN", name: "P2 冒烟店" },
  });
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: "SECOND", name: "P2 冒烟二店" },
  });
  await db.inventoryLocation.create({
    data: { storeId: store.id, code: "STOCK", kind: "WAREHOUSE" },
  });
  const material = await db.material.create({
    data: {
      tenantId: tenant.id,
      code: `SMOKE-${marker}`,
      name: "P2 冒烟花材",
      kind: "FLOWER",
      baseUnit: "支",
      standardUnitCost: 4,
      safetyStockThreshold: 5,
    },
  });
  const product = await db.product.create({
    data: { tenantId: tenant.id, code: `P-${marker}`, name: "P2 冒烟商品", active: true },
  });
  const sku = await db.productSku.create({
    data: { productId: product.id, code: `S-${marker}`, name: "冒烟 SKU", price: 100, active: true },
  });
  const order = await db.order.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      number: `SMOKE-ORD-${marker}`,
      createdVia: "STAFF_PORTAL",
      sourceChannel: "smoke",
      commercialState: "CONFIRMED",
      fulfillmentState: "DELIVERED",
      items: {
        create: { kind: "STANDARD", skuId: sku.id, nameSnapshot: "P2 冒烟商品", quantity: 1, unitPrice: 100 },
      },
      costSnapshots: {
        create: {
          revisionNo: 1,
          revenue: 100,
          materialCost: 40,
          packagingCost: 0,
          consumableCost: 0,
          laborCost: 10,
          deliveryCost: 0,
          platformCost: 0,
          attributedLossCost: 0,
          estimated: false,
          closedAt: new Date(),
        },
      },
    },
  });
  await db.auditEvent.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      action: currentAction,
      entityType: "Order",
      entityId: order.id,
      afterSnapshot: { state: "DELIVERED" },
      occurredAt: AUDIT_OCCURRED_AT,
    },
  });
  // Tenant-level event (storeId null) is visible from every store.
  await db.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: tenantAction,
      entityType: "Tenant",
      entityId: tenant.id,
      afterSnapshot: { note: "tenant level" },
      occurredAt: new Date(AUDIT_OCCURRED_AT.getTime() + 60 * 60 * 1000),
    },
  });
  // Another store in the same tenant must never leak into this store's query.
  await db.auditEvent.create({
    data: {
      tenantId: tenant.id,
      storeId: otherStore.id,
      action: otherStoreAction,
      entityType: "Order",
      entityId: order.id,
      occurredAt: new Date(AUDIT_OCCURRED_AT.getTime() + 2 * 60 * 60 * 1000),
    },
  });

  const scope = { tenantId: tenant.id, storeId: store.id };
  const range = resolveReportRange({ preset: "today" });
  const overview = await loadOverviewReport(db, scope, range);
  assert.equal(overview.summary.paidOrderCount, 1);
  assert.equal(overview.summary.revenue, 100);
  assert.equal(overview.summary.totalCost, 50);

  const dashboard = await loadDashboardData(db, scope);
  assert.equal(dashboard.metrics.todayOrderCount, 1);
  assert.equal(dashboard.metrics.todayRevenue, 100);
  assert.equal(dashboard.metrics.lowStockMaterialCount, 1);
  assert.equal(dashboard.lowStockItems.some((item) => item.materialId === material.id), true);
  assert.equal(dashboard.todos.length, 5);
  assert.equal(dashboard.recentOrders.some((row) => row.id === order.id), true);

  const quality = await collectDataQualityIssues(db, scope);
  assert.equal(Array.isArray(quality.issues), true);
  assert.equal(quality.issues.some((issue) => issue.entityId === material.id), true);
  assert.equal(quality.issues.some((issue) => issue.entityId === order.id), false);

  const setup = await loadSetupChecklist(db, scope);
  assert.equal(setup.stats.activeSkuWithoutRecipeCount, 1);
  assert.equal(setup.result.sections.length, 6);

  // Audit query: action, entity, date and page filters; current store plus
  // tenant-level events only, with out-of-range pages clamped to the last page.
  const filtered = await listV2AuditEvents(db, scope, {
    entityType: "Order",
    entityId: order.id,
    startDate: AUDIT_DAY,
    endDate: AUDIT_DAY,
  });
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.rows[0]!.entityId, order.id);
  assert.equal(filtered.rows[0]!.action, currentAction);
  assert.equal(filtered.rows[0]!.storeId, store.id);

  const audit = await listV2AuditEvents(db, scope, { action: marker });
  assert.equal(audit.pagination.total, 2);
  assert.equal(audit.pagination.page, 1);
  assert.equal(audit.rows[0]!.action, tenantAction);
  assert.equal(audit.rows[0]!.storeId, null);
  assert.equal(audit.rows.some((row) => row.action === currentAction), true);
  assert.equal(audit.rows.some((row) => row.action === otherStoreAction), false);

  const lastPage = await listV2AuditEvents(db, scope, { action: marker, page: 99, pageSize: 1 });
  assert.equal(lastPage.pagination.total, 2);
  assert.equal(lastPage.pagination.totalPages, 2);
  assert.equal(lastPage.pagination.page, 2);
  assert.equal(lastPage.rows.length, 1);
  assert.equal(lastPage.rows[0]!.action, currentAction);

  const actions = await listAuditActions(db, scope);
  assert.equal(actions.includes(currentAction), true);
  assert.equal(actions.includes(tenantAction), true);
  assert.equal(actions.includes(otherStoreAction), false);

  const health = await getV2SystemHealth(db, { checkDisk: false });
  assert.equal(health.checks.some((check) => check.key === "v2_database"), true);
  assert.equal(health.checks.some((check) => check.key === "v2_migrations"), true);

  console.log("v2 P2 operations smoke passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
