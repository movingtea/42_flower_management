import assert from "node:assert/strict";
import {
  aggregateHealthStatus,
  describeEnvPresence,
  diskStatusToHealthStatus,
  evaluateMigrationState,
  formatDiskMessage,
  isMissingMigrationTable,
  redactConnectionStrings,
  type HealthCheckItem,
} from "./system-health";

function testAggregate() {
  const ok: HealthCheckItem = { key: "a", title: "a", status: "OK", message: "ok" };
  const warning: HealthCheckItem = { key: "b", title: "b", status: "WARNING", message: "warn" };
  const error: HealthCheckItem = { key: "c", title: "c", status: "ERROR", message: "err" };
  assert.equal(aggregateHealthStatus([ok]), "OK");
  assert.equal(aggregateHealthStatus([ok, warning]), "WARNING");
  assert.equal(aggregateHealthStatus([ok, warning, error]), "ERROR");
  assert.equal(aggregateHealthStatus([]), "OK");
}

function testMigrations() {
  const local = ["0001_initial", "0002_sku", "0003_timestamps"];
  const applied = local.map((name) => ({
    migration_name: name,
    finished_at: "2026-11-01T00:00:00.000Z",
    rolled_back_at: null,
  }));
  const healthy = evaluateMigrationState(local, applied);
  assert.equal(healthy.status, "OK");
  assert.equal(healthy.latestLocal, "0003_timestamps");
  assert.equal(healthy.latestApplied, "0003_timestamps");

  const pending = evaluateMigrationState(local, applied.slice(0, 2));
  assert.equal(pending.status, "WARNING");
  assert.deepEqual(pending.pending, ["0003_timestamps"]);

  const failed = evaluateMigrationState(local, [
    ...applied,
    { migration_name: "0004_failed", finished_at: null, rolled_back_at: null },
  ]);
  assert.equal(failed.status, "ERROR");
  assert.deepEqual(failed.failed, ["0004_failed"]);

  const rolledBack = evaluateMigrationState(local, [
    ...applied.slice(0, 2),
    { migration_name: "0003_timestamps", finished_at: null, rolled_back_at: "2026-11-02T00:00:00.000Z" },
  ]);
  assert.equal(rolledBack.status, "ERROR");

  const dbAhead = evaluateMigrationState(local, [
    ...applied,
    { migration_name: "0009_hotfix", finished_at: "2026-11-02T00:00:00.000Z", rolled_back_at: null },
  ]);
  assert.equal(dbAhead.status, "WARNING");
  assert.deepEqual(dbAhead.appliedNotInCode, ["0009_hotfix"]);

  const unreadable = evaluateMigrationState([], applied);
  assert.equal(unreadable.status, "WARNING");
  assert.match(unreadable.message, /无法读取/);

  // A rolled-back migration must never be reported as the latest applied
  // revision, even when its name sorts last.
  const rolledBackLatest = evaluateMigrationState(local, [
    ...applied,
    { migration_name: "0004_hotfix", finished_at: null, rolled_back_at: "2026-11-02T00:00:00.000Z" },
  ]);
  assert.equal(rolledBackLatest.latestLocal, "0003_timestamps");
  assert.equal(rolledBackLatest.latestApplied, "0003_timestamps");

  const onlyFailedApplied = evaluateMigrationState(
    ["0001_initial"],
    [{ migration_name: "0001_initial", finished_at: null, rolled_back_at: null }],
  );
  assert.equal(onlyFailedApplied.latestApplied, null);
}

function testMigrationTableAndRedaction() {
  // A code alone is not enough: without evidence that the missing table is
  // `_prisma_migrations` the generic message is kept.
  assert.equal(isMissingMigrationTable({ code: "P2021" }), false);
  assert.equal(
    isMissingMigrationTable({
      code: "P2021",
      message: 'The table `_prisma_migrations` does not exist in the current database.',
    }),
    true,
  );
  assert.equal(
    isMissingMigrationTable({
      code: "P2010",
      meta: { code: "42P01" },
      message: 'Raw query failed. Message: `relation "_prisma_migrations" does not exist`',
    }),
    true,
  );
  assert.equal(
    isMissingMigrationTable({ message: 'relation "_prisma_migrations" does not exist' }),
    true,
  );
  assert.equal(isMissingMigrationTable({ message: "connection refused" }), false);

  const redacted = redactConnectionStrings(
    "connect failed: postgresql://flower_admin:super-secret@db:5432/flower_v2",
  );
  assert.doesNotMatch(redacted, /super-secret/);
  assert.match(redacted, /postgresql:\/\/\*\*\*/);
  assert.equal(redactConnectionStrings("disk 92% used"), "disk 92% used");
}

function testEnvAndDisk() {
  const missing = describeEnvPresence(
    ["V2_DATABASE_URL", "AUTH_SECRET", "ALIYUN_OSS_ACCESS_KEY_ID"],
    { V2_DATABASE_URL: true, AUTH_SECRET: false, ALIYUN_OSS_ACCESS_KEY_ID: true },
  );
  assert.equal(missing.status, "WARNING");
  assert.deepEqual(missing.missing, ["AUTH_SECRET"]);
  assert.doesNotMatch(missing.message, /secret-value/);

  assert.equal(describeEnvPresence(["A"], { A: true }).status, "OK");
  assert.equal(diskStatusToHealthStatus("CRITICAL"), "ERROR");
  assert.equal(diskStatusToHealthStatus("UNKNOWN"), "UNKNOWN");
  assert.equal(formatDiskMessage(50).status, "OK");
  assert.equal(formatDiskMessage(85).status, "WARNING");
  assert.equal(formatDiskMessage(95).status, "ERROR");
  assert.equal(formatDiskMessage(null).status, "UNKNOWN");
}

function run() {
  testAggregate();
  testMigrations();
  testEnvAndDisk();
  testMigrationTableAndRedaction();
  console.log("v2 system health domain tests passed");
}

run();
