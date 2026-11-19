/**
 * Release-candidate query-plan evidence for the 0010 index.
 *
 * Creates a synthetic tenant/store, then runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) against the
 * real reservation-candidate / material-availability / order-list / audit queries. Prints one
 * compact JSON object and fails when the reservation-candidate plan does not use
 * "InventoryBatch_storeId_materialId_idx" (migration 0010).
 *
 * This script is read-only against an isolated managed V2 test database and deletes only the rows
 * it created. It refuses to run without the managed DB contract:
 *   WMS_TEST_DB_MANAGED=1
 *   V2_DATABASE_URL with host 127.0.0.1 and an explicit non-5432 port
 *
 * Run (Lead, isolated PostgreSQL):
 *   $env:WMS_TEST_DB_MANAGED = "1"
 *   $env:V2_DATABASE_URL = "postgresql://user:pass@127.0.0.1:55440/wms_<hex>_test"
 *   npx tsx scripts/release-candidate/perf-inventory-query.ts
 *
 * Or let the repository harness provision a throw-away cluster and set the contract:
 *   node scripts/with-v2-test-db.mjs -- node node_modules/tsx/dist/cli.mjs scripts/release-candidate/perf-inventory-query.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, MaterialKind, OrderEntry, PrismaClient,
} from "../../src/generated/prisma-v2/client";

const MATERIAL_COUNT = 50;
const BATCHES_PER_MATERIAL = 100;
const ORDER_COUNT = 1_500;
const AUDIT_COUNT = 3_000;
const TARGET_INDEX = "InventoryBatch_storeId_materialId_idx";
const DAY_MS = 86_400_000;

type PlanNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Plan Rows"?: number;
  "Actual Rows"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
};

type ExplainDocument = {
  Plan: PlanNode;
  "Planning Time"?: number;
  "Execution Time"?: number;
};

type QueryEvidence = {
  name: string;
  sqlShape: string;
  nodeTypes: string[];
  indexNames: string[];
  planRows: number | null;
  actualRows: number | null;
  planningTimeMs: number | null;
  executionTimeMs: number | null;
  sharedHitBlocks: number | null;
  sharedReadBlocks: number | null;
  targetIndexUsed: boolean;
};

class EnvironmentError extends Error {
  readonly exitCode = 2;
}

function requireManagedEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.WMS_TEST_DB_MANAGED !== "1") {
    throw new EnvironmentError("WMS_TEST_DB_MANAGED=1 is required; refusing to run a perf plan on an unmanaged database");
  }
  const raw = env.V2_DATABASE_URL;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new EnvironmentError("V2_DATABASE_URL is required");
  }
  if (raw !== raw.trim()) {
    throw new EnvironmentError("V2_DATABASE_URL must not contain surrounding whitespace");
  }
  if (/[?#]/.test(raw)) {
    throw new EnvironmentError("V2_DATABASE_URL must not include a query or fragment");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvironmentError("V2_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new EnvironmentError("V2_DATABASE_URL must use postgres:// or postgresql://");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new EnvironmentError("V2_DATABASE_URL host must be 127.0.0.1");
  }
  if (url.port === "") {
    throw new EnvironmentError("V2_DATABASE_URL must include an explicit port");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvironmentError("V2_DATABASE_URL port must be 1-65535");
  }
  if (port === 5432) {
    throw new EnvironmentError("V2_DATABASE_URL must not use the default PostgreSQL port 5432");
  }
  return raw;
}

function parseExplain(rows: unknown[], label: string): ExplainDocument {
  const first = rows[0];
  if (!first || typeof first !== "object") {
    throw new Error(`${label}: EXPLAIN returned no document`);
  }
  const record = first as Record<string, unknown>;
  const raw = record["QUERY PLAN"] ?? Object.values(record)[0];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const document = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!document || typeof document !== "object" || !("Plan" in document)) {
    throw new Error(`${label}: EXPLAIN JSON did not contain a Plan node`);
  }
  return document as ExplainDocument;
}

function collectPlan(
  root: PlanNode,
  nodeTypes: Set<string>,
  indexNames: Set<string>,
): void {
  if (root["Node Type"]) nodeTypes.add(root["Node Type"]);
  if (root["Index Name"]) indexNames.add(root["Index Name"]);
  for (const child of root.Plans ?? []) collectPlan(child, nodeTypes, indexNames);
}

async function explain(
  db: PrismaClient,
  name: string,
  sqlShape: string,
  sql: string,
  params: unknown[],
): Promise<QueryEvidence> {
  const rows = await db.$queryRawUnsafe<unknown[]>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    ...params,
  );
  const document = parseExplain(rows, name);
  const nodeTypes = new Set<string>();
  const indexNames = new Set<string>();
  collectPlan(document.Plan, nodeTypes, indexNames);
  return {
    name,
    sqlShape,
    nodeTypes: [...nodeTypes],
    indexNames: [...indexNames],
    planRows: document.Plan["Plan Rows"] ?? null,
    actualRows: document.Plan["Actual Rows"] ?? null,
    planningTimeMs: document["Planning Time"] ?? null,
    executionTimeMs: document["Execution Time"] ?? null,
    sharedHitBlocks: document.Plan["Shared Hit Blocks"] ?? null,
    sharedReadBlocks: document.Plan["Shared Read Blocks"] ?? null,
    targetIndexUsed: indexNames.has(TARGET_INDEX),
  };
}

type SeedIds = {
  tenantId: string;
  storeId: string;
  locationId: string;
  materialIds: string[];
};

async function seed(db: PrismaClient, marker: string): Promise<SeedIds> {
  const tenant = await db.tenant.create({
    data: { slug: `rc-perf-${marker}`, name: "RC perf 租户" },
  });
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: `PERF-${marker}`, name: "RC perf 门店" },
  });
  const location = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `PERF-STOCK-${marker}`, kind: LocationKind.WAREHOUSE },
  });

  const materialIds = Array.from({ length: MATERIAL_COUNT }, (_, index) =>
    `perf-mat-${marker}-${index}`);
  await db.material.createMany({
    data: materialIds.map((id, index) => ({
      id,
      tenantId: tenant.id,
      code: `MAT-PERF-${marker}-${index}`,
      name: `Perf 花材 ${index}`,
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 0,
    })),
  });

  const now = Date.now();
  const batches = materialIds.flatMap((materialId, materialIndex) =>
    Array.from({ length: BATCHES_PER_MATERIAL }, (_, batchIndex) => {
      const sequence = materialIndex * BATCHES_PER_MATERIAL + batchIndex;
      const cycle = sequence % 4;
      return {
        id: `perf-batch-${marker}-${sequence}`,
        storeId: store.id,
        materialId,
        batchNo: `B-${marker}-${sequence}`,
        unitCost: 2,
        receivedAt: new Date(now - (sequence % 30) * DAY_MS),
        // Null and future rows pass the reservation filter; past rows force the residual filter.
        usableUntil: cycle === 0
          ? null
          : new Date(now + (cycle === 2 ? -1 : 14 + cycle) * DAY_MS),
      };
    }));
  await db.inventoryBatch.createMany({ data: batches });
  await db.batchBalance.createMany({
    data: batches.map((batch, index) => ({
      batchId: batch.id,
      locationId: location.id,
      onHandQty: 50 + (index % 11),
    })),
  });

  const base = now + DAY_MS;
  await db.order.createMany({
    data: Array.from({ length: ORDER_COUNT }, (_, index) => ({
      id: `perf-order-${marker}-${index}`,
      tenantId: tenant.id,
      storeId: store.id,
      number: `PERF-${marker}-${index}`,
      createdVia: OrderEntry.STAFF_PORTAL,
      sourceChannel: "perf",
      deliveryAt: new Date(base + (index % 60) * DAY_MS + index * 60_000),
      createdAt: new Date(now - (index % 30) * DAY_MS - index * 1_000),
    })),
  });

  await db.auditEvent.createMany({
    data: Array.from({ length: AUDIT_COUNT }, (_, index) => ({
      id: `perf-audit-${marker}-${index}`,
      tenantId: tenant.id,
      storeId: store.id,
      action: "PERF_PLAN",
      entityType: "Order",
      occurredAt: new Date(now - index * 60_000),
    })),
  });

  // Statistics decide the plan; without ANALYZE the planner guesses from the empty table.
  await db.$executeRawUnsafe('ANALYZE "InventoryBatch"');
  await db.$executeRawUnsafe('ANALYZE "BatchBalance"');
  await db.$executeRawUnsafe('ANALYZE "Order"');
  await db.$executeRawUnsafe('ANALYZE "AuditEvent"');

  return { tenantId: tenant.id, storeId: store.id, locationId: location.id, materialIds };
}

async function cleanup(db: PrismaClient, ids: Partial<SeedIds>): Promise<void> {
  if (ids.tenantId) {
    await db.auditEvent.deleteMany({ where: { tenantId: ids.tenantId } });
  }
  if (ids.tenantId && ids.storeId) {
    await db.order.deleteMany({ where: { tenantId: ids.tenantId, storeId: ids.storeId } });
    await db.batchBalance.deleteMany({ where: { batch: { storeId: ids.storeId } } });
    await db.inventoryBatch.deleteMany({ where: { storeId: ids.storeId } });
    await db.material.deleteMany({ where: { tenantId: ids.tenantId } });
    await db.inventoryLocation.deleteMany({ where: { storeId: ids.storeId } });
  }
  if (ids.storeId) {
    await db.store.deleteMany({ where: { id: ids.storeId } });
  }
  if (ids.tenantId) {
    await db.tenant.deleteMany({ where: { id: ids.tenantId } });
  }
}

async function run(db: PrismaClient, marker: string, ids: SeedIds) {
  const needBy = new Date(Date.now() + 7 * DAY_MS);
  const targetMaterial = ids.materialIds[0];
  const sampleMaterials = ids.materialIds.slice(0, 5);

  const queries: QueryEvidence[] = [];
  queries.push(await explain(
    db,
    "reservation_candidates",
    'InventoryBatch WHERE storeId + materialId + usableUntil, ORDER BY id',
    `SELECT "id" FROM "InventoryBatch"
      WHERE "storeId" = $1
        AND "materialId" = $2
        AND ("usableUntil" IS NULL OR "usableUntil" >= $3)
      ORDER BY "id" ASC`,
    [ids.storeId, targetMaterial, needBy],
  ));
  queries.push(await explain(
    db,
    "material_availability",
    'InventoryBatch WHERE storeId + materialId IN (...) + usableUntil',
    `SELECT "id", "materialId" FROM "InventoryBatch"
      WHERE "storeId" = $1
        AND "materialId" IN ($2, $3, $4, $5, $6)
        AND ("usableUntil" IS NULL OR "usableUntil" >= $7)
      ORDER BY "id" ASC`,
    [ids.storeId, ...sampleMaterials, needBy],
  ));
  queries.push(await explain(
    db,
    "order_list",
    'Order WHERE tenantId + storeId ORDER BY deliveryAt ASC, createdAt DESC LIMIT 25',
    `SELECT "id" FROM "Order"
      WHERE "tenantId" = $1 AND "storeId" = $2
      ORDER BY "deliveryAt" ASC, "createdAt" DESC
      LIMIT 25`,
    [ids.tenantId, ids.storeId],
  ));
  queries.push(await explain(
    db,
    "audit_list",
    'AuditEvent WHERE tenantId + (storeId matches) ORDER BY occurredAt DESC LIMIT 50',
    `SELECT "id" FROM "AuditEvent"
      WHERE "tenantId" = $1 AND ("storeId" = $2 OR "storeId" IS NULL)
      ORDER BY "occurredAt" DESC, "id" DESC
      LIMIT 50`,
    [ids.tenantId, ids.storeId],
  ));

  const reservation = queries.find((query) => query.name === "reservation_candidates");
  const indexes = new Set(queries.flatMap((query) => query.indexNames));
  const result = {
    ok: Boolean(reservation?.targetIndexUsed && (reservation?.actualRows ?? 0) > 0),
    database: "managed isolated V2 test database (127.0.0.1, non-5432)",
    marker,
    dataset: {
      tenantId: ids.tenantId,
      storeId: ids.storeId,
      materials: MATERIAL_COUNT,
      batches: MATERIAL_COUNT * BATCHES_PER_MATERIAL,
      orders: ORDER_COUNT,
      auditEvents: AUDIT_COUNT,
    },
    targetIndex: TARGET_INDEX,
    index0010UsedByInventoryQuery: reservation?.targetIndexUsed ?? false,
    checks: {
      reservationCandidatesReturnRows: (reservation?.actualRows ?? 0) > 0,
      allQueryIndexNames: [...indexes],
    },
    queries,
  };

  // Print before asserting so a failing plan is still visible in the captured output.
  console.log(JSON.stringify(result, null, 2));

  if (!reservation) throw new Error("reservation_candidates query evidence is missing");
  if (!reservation.targetIndexUsed) {
    throw new Error(
      `0010 index ${TARGET_INDEX} was not used by the reservation-candidate query; ` +
      `observed node types [${reservation.nodeTypes.join(", ")}], ` +
      `indexes [${reservation.indexNames.join(", ") || "none"}]`,
    );
  }
  if ((reservation.actualRows ?? 0) <= 0) {
    throw new Error("reservation-candidate query returned no rows; the plan is not representative");
  }
}

async function main(): Promise<void> {
  const connectionString = requireManagedEnvironment(process.env);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const marker = crypto.randomUUID().slice(0, 8);
  const ids: Partial<SeedIds> = {};
  let failure: unknown;
  try {
    const seeded = await seed(db, marker);
    Object.assign(ids, seeded);
    await run(db, marker, seeded);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await cleanup(db, ids);
    } catch (error) {
      console.error("release-candidate perf cleanup failed", error);
      if (!failure) failure = error;
    }
    await db.$disconnect();
  }
  if (failure) throw failure;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`release-candidate perf: ${message}`);
  process.exitCode = error instanceof EnvironmentError ? error.exitCode : 1;
});
