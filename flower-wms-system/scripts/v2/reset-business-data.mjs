#!/usr/bin/env node
/**
 * Reset the V2 business data while keeping the account scaffolding.
 *
 * Kept tables: Tenant, Store, InventoryLocation, StoreSettings, StaffUser,
 * TenantMember, StoreMember and the Prisma migration history. Every other
 * public table is truncated, so staff can log in with their existing accounts
 * and start from a clean operational dataset.
 *
 * Safety:
 *   - Refuses non-local hosts or non _test/_dev database names unless --force.
 *   - Takes a custom-format pg_dump backup before truncating.
 *   - Verifies the kept row counts and that business tables are empty.
 *
 * Usage (from flower-wms-system/):
 *   node --env-file=.env.local scripts/v2/reset-business-data.mjs
 *   node --env-file=.env.local scripts/v2/reset-business-data.mjs --dry-run
 *   node --env-file=.env.local scripts/v2/reset-business-data.mjs --force
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const KEEP_TABLE_CANDIDATES = [
  "Tenant",
  "Store",
  "InventoryLocation",
  "StoreSettings",
  "StaffUser",
  "TenantMember",
  "StoreMember",
  "_prisma_migrations",
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

const databaseUrl = process.env.V2_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("V2_DATABASE_URL is not set. Run with --env-file=.env.local.");
  process.exit(1);
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

const target = parseDatabaseUrl(databaseUrl);
const localHost = ["127.0.0.1", "localhost", "::1"].includes(target.host);
const disposableDb = /_(test|dev)$/.test(target.database);

if (!force && (!localHost || !disposableDb)) {
  console.error(
    `Refusing to reset ${target.host}:${target.port}/${target.database}. ` +
      "Only local _test/_dev databases are allowed; pass --force to override.",
  );
  process.exit(1);
}

function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

async function listPublicTables(client) {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
  );
  return rows.map((row) => row.table_name);
}

async function countRows(client, table) {
  const { rows } = await client.query(`select count(*)::int as n from ${quoteIdent(table)}`);
  return rows[0].n;
}

function backupDatabase() {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  const dir = resolve(process.cwd(), "..", ".runtime", "db-backups");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `flower-v2-business-${stamp}.dump`);
  // libpq rejects Prisma's `?schema=public` query parameter, so dump with a
  // clean connection string derived from the same URL.
  const clean = new URL(databaseUrl);
  clean.search = "";
  const result = spawnSync("pg_dump", ["--dbname", clean.toString(), "--format=custom", "--file", file], {
    encoding: "utf8",
  });
  if (result.error) throw new Error(`pg_dump failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`pg_dump failed (${result.status}): ${result.stderr?.trim() || "no stderr"}`);
  }
  const size = statSync(file).size;
  const listed = spawnSync("pg_restore", ["--list", file], { encoding: "utf8" });
  if (listed.status !== 0) {
    throw new Error(`backup verification failed: ${listed.stderr?.trim() || "pg_restore --list failed"}`);
  }
  return { file, size, tableEntries: listed.stdout.split("\n").filter(Boolean).length };
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await listPublicTables(client);
    const keep = KEEP_TABLE_CANDIDATES.filter((name) => tables.includes(name));
    const truncate = tables.filter((name) => !keep.includes(name));

    const before = {};
    for (const table of keep) before[table] = await countRows(client, table);

    console.log(`Target: ${target.host}:${target.port}/${target.database}`);
    console.log(`Tables: ${tables.length} total, ${keep.length} kept, ${truncate.length} to truncate`);
    console.log(`Kept row counts: ${JSON.stringify(before)}`);
    if (dryRun) {
      console.log("Dry run: no backup taken and no data changed.");
      return;
    }

    const backup = backupDatabase();
    console.log(`Backup: ${backup.file} (${backup.size} bytes, ${backup.tableEntries} TOC entries)`);

    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${truncate.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`,
    );

    // Test runs create throw-away tenants/stores. Keep only the scaffolding that
    // actually backs a staff membership; delete child rows of orphan stores
    // first, then the stores, then tenants that no longer have members or stores.
    const orphanStores = await client.query(
      `SELECT id FROM "Store" WHERE NOT EXISTS (SELECT 1 FROM "StoreMember" m WHERE m."storeId" = "Store".id)`,
    );
    const orphanStoreIds = orphanStores.rows.map((row) => row.id);
    if (orphanStoreIds.length > 0) {
      await client.query(`DELETE FROM "StoreSettings" WHERE "storeId" = ANY($1::text[])`, [orphanStoreIds]);
      await client.query(`DELETE FROM "InventoryLocation" WHERE "storeId" = ANY($1::text[])`, [orphanStoreIds]);
      await client.query(`DELETE FROM "Store" WHERE id = ANY($1::text[])`, [orphanStoreIds]);
    }
    const orphanTenants = await client.query(
      `DELETE FROM "Tenant" t WHERE NOT EXISTS (SELECT 1 FROM "TenantMember" m WHERE m."tenantId" = t.id) AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."tenantId" = t.id) RETURNING id`,
    );
    await client.query("COMMIT");

    console.log(
      `Removed test-scaffolding rows: stores=${orphanStoreIds.length}, tenants=${orphanTenants.rowCount}`,
    );

    const after = {};
    for (const table of keep) after[table] = await countRows(client, table);
    const leftovers = [];
    for (const table of truncate) {
      const n = await countRows(client, table);
      if (n !== 0) leftovers.push(`${table}=${n}`);
    }

    const keepStable = keep
      .filter((table) => table !== "Store" && table !== "Tenant")
      .every((table) => before[table] === after[table]);
    console.log(`Kept row counts after: ${JSON.stringify(after)}`);
    console.log(`Kept account/location tables unchanged: ${keepStable}`);
    console.log(
      leftovers.length === 0
        ? "All business tables are empty."
        : `WARNING leftovers: ${leftovers.join(", ")}`,
    );
    console.log(
      `Rollback: pg_restore --clean --if-exists --no-owner --dbname "$V2_DATABASE_URL" "${backup.file}"`,
    );
    if (!keepStable || leftovers.length > 0) process.exitCode = 2;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
