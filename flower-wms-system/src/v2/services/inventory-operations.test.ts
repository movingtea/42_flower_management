import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, MaterialKind, PrismaClient, TransactionKind,
} from "../../generated/prisma-v2-draft/client";
import {
  adjustInventory, transferInventory, type InventoryOperationScope,
} from "./inventory-operations";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("V2_DATABASE_URL or DATABASE_URL is required for inventory-operation tests");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);
const tenantIds: string[] = [];

function scopeOf(tenantId: string, storeId: string): InventoryOperationScope {
  return { tenantId, storeId, actorStaffId: "staff-inventory-test" };
}

function newKey(label: string): string {
  return `${label}-${marker}-${crypto.randomUUID()}`;
}

async function adjust(
  scope: InventoryOperationScope,
  input: Parameters<typeof adjustInventory>[2],
) {
  return db.$transaction((tx) => adjustInventory(tx, scope, input));
}

async function transfer(
  scope: InventoryOperationScope,
  input: Parameters<typeof transferInventory>[2],
) {
  return db.$transaction((tx) => transferInventory(tx, scope, input));
}

async function balanceQty(batchId: string, locationId: string): Promise<number> {
  const balance = await db.batchBalance.findUnique({
    where: { batchId_locationId: { batchId, locationId } },
  });
  return Number(balance?.onHandQty ?? 0);
}

async function batchTotal(batchId: string): Promise<number> {
  const balances = await db.batchBalance.findMany({ where: { batchId } });
  return balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `v2-inventory-ops-${marker}`, name: "V2 库存操作测试租户" },
  });
  tenantIds.push(tenant.id);
  const store = await db.store.create({
    data: { tenantId: tenant.id, code: `MAIN-${marker}`, name: "库存操作测试店" },
  });
  const otherStore = await db.store.create({
    data: { tenantId: tenant.id, code: `OTHER-${marker}`, name: "同租户另一门店" },
  });
  const otherTenant = await db.tenant.create({
    data: { slug: `v2-inventory-ops-other-${marker}`, name: "另一租户" },
  });
  tenantIds.push(otherTenant.id);
  const otherTenantStore = await db.store.create({
    data: { tenantId: otherTenant.id, code: `FOREIGN-${marker}`, name: "另一租户门店" },
  });

  const locationA = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `A-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  const locationB = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `B-${marker}`, kind: LocationKind.PRODUCTION },
  });
  const locationD = await db.inventoryLocation.create({
    data: { storeId: store.id, code: `D-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  const locationOtherStore = await db.inventoryLocation.create({
    data: { storeId: otherStore.id, code: `C-${marker}`, kind: LocationKind.WAREHOUSE },
  });
  const locationOtherTenant = await db.inventoryLocation.create({
    data: { storeId: otherTenantStore.id, code: `F-${marker}`, kind: LocationKind.WAREHOUSE },
  });

  const material = await db.material.create({
    data: {
      tenantId: tenant.id,
      code: `MAT-${marker}`,
      name: "库存操作测试花材",
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 2,
    },
  });
  const foreignMaterial = await db.material.create({
    data: {
      tenantId: otherTenant.id,
      code: `FMAT-${marker}`,
      name: "另一租户花材",
      kind: MaterialKind.FLOWER,
      baseUnit: "支",
      quantityScale: 2,
    },
  });

  const mainBatch = await db.inventoryBatch.create({
    data: { storeId: store.id, materialId: material.id, batchNo: `MAIN-${marker}`, unitCost: 1 },
  });
  await db.batchBalance.createMany({
    data: [
      { batchId: mainBatch.id, locationId: locationA.id, onHandQty: 10 },
      { batchId: mainBatch.id, locationId: locationB.id, onHandQty: 2 },
    ],
  });
  const transferBatch = await db.inventoryBatch.create({
    data: { storeId: store.id, materialId: material.id, batchNo: `TRANSFER-${marker}`, unitCost: 1 },
  });
  await db.batchBalance.createMany({
    data: [
      { batchId: transferBatch.id, locationId: locationA.id, onHandQty: 5 },
      { batchId: transferBatch.id, locationId: locationB.id, onHandQty: 1 },
    ],
  });
  const otherStoreBatch = await db.inventoryBatch.create({
    data: { storeId: otherStore.id, materialId: material.id, batchNo: `OTHER-${marker}`, unitCost: 1 },
  });
  await db.batchBalance.create({
    data: { batchId: otherStoreBatch.id, locationId: locationOtherStore.id, onHandQty: 50 },
  });
  const foreignBatch = await db.inventoryBatch.create({
    data: {
      storeId: otherTenantStore.id,
      materialId: foreignMaterial.id,
      batchNo: `FOREIGN-${marker}`,
      unitCost: 1,
    },
  });
  await db.batchBalance.create({
    data: { batchId: foreignBatch.id, locationId: locationOtherTenant.id, onHandQty: 50 },
  });

  const scope = scopeOf(tenant.id, store.id);

  // Increase, exact retry, then a reused key with a different payload.
  const increaseKey = newKey("ADJ-INC");
  const increased = await adjust(scope, {
    batchId: mainBatch.id,
    locationId: locationA.id,
    mode: "INCREASE",
    quantity: 1.5,
    reason: "盘点补录",
    idempotencyKey: increaseKey,
  });
  assert.equal(increased.idempotent, false);
  assert.equal(increased.mode, "INCREASE");
  assert.equal(increased.quantity, 1.5);
  assert.equal(increased.locationOnHand, 11.5);
  assert.equal(increased.batchOnHand, 13.5);
  const increaseTransaction = await db.inventoryTransaction.findUniqueOrThrow({
    where: { idempotencyKey: increaseKey },
  });
  assert.equal(increaseTransaction.kind, TransactionKind.ADJUSTMENT);
  assert.equal(increaseTransaction.toLocationId, locationA.id);
  assert.equal(increaseTransaction.fromLocationId, null);
  assert.equal(Number(increaseTransaction.quantity), 1.5);
  assert.equal(await db.auditEvent.count({
    where: { entityId: increaseTransaction.id, action: "INVENTORY_ADJUSTED" },
  }), 1);

  const increaseRetry = await adjust(scope, {
    batchId: mainBatch.id,
    locationId: locationA.id,
    mode: "INCREASE",
    quantity: 1.5,
    reason: "盘点补录",
    idempotencyKey: increaseKey,
  });
  assert.equal(increaseRetry.idempotent, true);
  assert.equal(increaseRetry.transactionId, increaseTransaction.id);
  assert.equal(increaseRetry.locationOnHand, 11.5);
  assert.equal(increaseRetry.batchOnHand, 13.5);
  assert.equal(await balanceQty(mainBatch.id, locationA.id), 11.5);
  assert.equal(await db.auditEvent.count({
    where: { entityId: increaseTransaction.id, action: "INVENTORY_ADJUSTED" },
  }), 1);

  await assert.rejects(
    adjust(scope, {
      batchId: mainBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 2.5,
      reason: "盘点补录",
      idempotencyKey: increaseKey,
    }),
    /幂等键/,
  );
  assert.equal(await balanceQty(mainBatch.id, locationA.id), 11.5);
  assert.equal(await db.inventoryTransaction.count({ where: { idempotencyKey: increaseKey } }), 1);

  // Decrease uses fromLocationId and is also exactly idempotent.
  const decreaseKey = newKey("ADJ-DEC");
  const decreased = await adjust(scope, {
    batchId: mainBatch.id,
    locationId: locationA.id,
    mode: "DECREASE",
    quantity: 1.5,
    reason: "报损前调整",
    idempotencyKey: decreaseKey,
  });
  assert.equal(decreased.idempotent, false);
  assert.equal(decreased.locationOnHand, 10);
  assert.equal(decreased.batchOnHand, 12);
  const decreaseTransaction = await db.inventoryTransaction.findUniqueOrThrow({
    where: { idempotencyKey: decreaseKey },
  });
  assert.equal(decreaseTransaction.fromLocationId, locationA.id);
  assert.equal(decreaseTransaction.toLocationId, null);
  const decreaseRetry = await adjust(scope, {
    batchId: mainBatch.id,
    locationId: locationA.id,
    mode: "DECREASE",
    quantity: 1.5,
    reason: "报损前调整",
    idempotencyKey: decreaseKey,
  });
  assert.equal(decreaseRetry.idempotent, true);
  assert.equal(decreaseRetry.transactionId, decreaseTransaction.id);
  assert.equal(await balanceQty(mainBatch.id, locationA.id), 10);

  // DECREASE cannot pass on-hand, frozen or unreserved availability.
  await assert.rejects(
    adjust(scope, {
      batchId: mainBatch.id,
      locationId: locationB.id,
      mode: "DECREASE",
      quantity: 2.5,
      reason: "超量报损",
      idempotencyKey: newKey("ADJ-OVER"),
    }),
    /可用库存不足/,
  );
  assert.equal(await balanceQty(mainBatch.id, locationB.id), 2);
  await db.batchBalance.update({
    where: { batchId_locationId: { batchId: mainBatch.id, locationId: locationA.id } },
    data: { frozenQty: 3 },
  });
  await assert.rejects(
    adjust(scope, {
      batchId: mainBatch.id,
      locationId: locationA.id,
      mode: "DECREASE",
      quantity: 7.01,
      reason: "动用冻结库存",
      idempotencyKey: newKey("ADJ-FROZEN"),
    }),
    /可用库存不足/,
  );
  assert.equal(await balanceQty(mainBatch.id, locationA.id), 10);
  await db.batchBalance.update({
    where: { batchId_locationId: { batchId: mainBatch.id, locationId: locationA.id } },
    data: { frozenQty: 0 },
  });

  // Quantity validation: finite, positive and on the material scale.
  for (const [quantity, pattern] of [
    [0, /大于零/],
    [-1, /大于零/],
    [Number.NaN, /有限/],
    [Number.POSITIVE_INFINITY, /有限/],
    [0.001, /计量精度/],
  ] as const) {
    await assert.rejects(
      adjust(scope, {
        batchId: mainBatch.id,
        locationId: locationA.id,
        mode: "INCREASE",
        quantity,
        reason: "非法数量",
        idempotencyKey: newKey("ADJ-BAD"),
      }),
      pattern,
    );
  }
  assert.equal(await batchTotal(mainBatch.id), 12);

  // Transfer keeps the batch total unchanged and moves quantity between both balances.
  const transferKey = newKey("TRF-MOVE");
  const totalBeforeTransfer = await batchTotal(transferBatch.id);
  const moved = await transfer(scope, {
    batchId: transferBatch.id,
    fromLocationId: locationA.id,
    toLocationId: locationB.id,
    quantity: 3,
    reason: "库内调拨",
    idempotencyKey: transferKey,
  });
  assert.equal(moved.idempotent, false);
  assert.equal(moved.fromOnHand, 2);
  assert.equal(moved.toOnHand, 4);
  assert.equal(moved.batchOnHand, totalBeforeTransfer);
  assert.equal(await batchTotal(transferBatch.id), totalBeforeTransfer);
  assert.equal(await balanceQty(transferBatch.id, locationA.id), 2);
  assert.equal(await balanceQty(transferBatch.id, locationB.id), 4);
  const transferTransaction = await db.inventoryTransaction.findUniqueOrThrow({
    where: { idempotencyKey: transferKey },
  });
  assert.equal(transferTransaction.kind, TransactionKind.TRANSFER);
  assert.equal(transferTransaction.fromLocationId, locationA.id);
  assert.equal(transferTransaction.toLocationId, locationB.id);

  const transferRetry = await transfer(scope, {
    batchId: transferBatch.id,
    fromLocationId: locationA.id,
    toLocationId: locationB.id,
    quantity: 3,
    reason: "库内调拨",
    idempotencyKey: transferKey,
  });
  assert.equal(transferRetry.idempotent, true);
  assert.equal(transferRetry.transactionId, transferTransaction.id);
  assert.equal(transferRetry.fromOnHand, 2);
  assert.equal(transferRetry.toOnHand, 4);
  assert.equal(await db.auditEvent.count({
    where: { entityId: transferTransaction.id, action: "INVENTORY_TRANSFERRED" },
  }), 1);

  await assert.rejects(
    transfer(scope, {
      batchId: transferBatch.id,
      fromLocationId: locationA.id,
      toLocationId: locationB.id,
      quantity: 1,
      reason: "库内调拨",
      idempotencyKey: transferKey,
    }),
    /幂等键/,
  );
  await assert.rejects(
    transfer(scope, {
      batchId: transferBatch.id,
      fromLocationId: locationA.id,
      toLocationId: locationA.id,
      quantity: 1,
      idempotencyKey: newKey("TRF-SAME"),
    }),
    /不能相同/,
  );
  await assert.rejects(
    transfer(scope, {
      batchId: transferBatch.id,
      fromLocationId: locationA.id,
      toLocationId: locationB.id,
      quantity: 2.01,
      idempotencyKey: newKey("TRF-OVER"),
    }),
    /可用库存不足/,
  );
  await assert.rejects(
    transfer(scope, {
      batchId: transferBatch.id,
      fromLocationId: locationA.id,
      toLocationId: locationOtherStore.id,
      quantity: 1,
      idempotencyKey: newKey("TRF-CROSS-STORE"),
    }),
    /库位.*不属于当前门店/,
  );
  await assert.rejects(
    transfer(scope, {
      batchId: otherStoreBatch.id,
      fromLocationId: locationOtherStore.id,
      toLocationId: locationB.id,
      quantity: 1,
      idempotencyKey: newKey("TRF-CROSS-BATCH"),
    }),
    /库存批次.*不属于当前门店/,
  );
  for (const [quantity, pattern] of [
    [0, /大于零/],
    [-2, /大于零/],
    [0.001, /计量精度/],
  ] as const) {
    await assert.rejects(
      transfer(scope, {
        batchId: transferBatch.id,
        fromLocationId: locationA.id,
        toLocationId: locationB.id,
        quantity,
        idempotencyKey: newKey("TRF-BAD"),
      }),
      pattern,
    );
  }

  // A target location without a balance row must be created, and the return/audit total must
  // still include the newly created target quantity (regression for an omitted target balance).
  const newTargetKey = newKey("TRF-NEW-TARGET");
  const newTarget = await transfer(scope, {
    batchId: transferBatch.id,
    fromLocationId: locationA.id,
    toLocationId: locationD.id,
    quantity: 1,
    reason: "新库位调拨",
    idempotencyKey: newTargetKey,
  });
  assert.equal(newTarget.fromOnHand, 1);
  assert.equal(newTarget.toOnHand, 1);
  assert.equal(newTarget.batchOnHand, totalBeforeTransfer);
  assert.equal(await batchTotal(transferBatch.id), totalBeforeTransfer);
  assert.equal(await balanceQty(transferBatch.id, locationD.id), 1);
  const newTargetAudit = await db.auditEvent.findFirstOrThrow({
    where: {
      entityId: (await db.inventoryTransaction.findUniqueOrThrow({
        where: { idempotencyKey: newTargetKey },
      })).id,
      action: "INVENTORY_TRANSFERRED",
    },
  });
  assert.equal(
    Number((newTargetAudit.afterSnapshot as Record<string, unknown>).batchOnHand),
    totalBeforeTransfer,
  );

  await db.batchBalance.update({
    where: { batchId_locationId: { batchId: transferBatch.id, locationId: locationA.id } },
    data: { frozenQty: 1 },
  });
  await assert.rejects(
    transfer(scope, {
      batchId: transferBatch.id,
      fromLocationId: locationA.id,
      toLocationId: locationB.id,
      quantity: 0.01,
      idempotencyKey: newKey("TRF-FROZEN"),
    }),
    /可用库存不足/,
  );

  // Cross-store and cross-tenant material references are rejected before any write.
  await assert.rejects(
    adjust(scope, {
      batchId: otherStoreBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "跨店库存",
      idempotencyKey: newKey("ADJ-CROSS-BATCH"),
    }),
    /库存批次.*不属于当前门店/,
  );
  await assert.rejects(
    adjust(scope, {
      batchId: mainBatch.id,
      locationId: locationOtherStore.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "跨店库位",
      idempotencyKey: newKey("ADJ-CROSS-LOC"),
    }),
    /库位.*不属于当前门店/,
  );
  await assert.rejects(
    adjust(scopeOf(otherTenant.id, store.id), {
      batchId: mainBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "跨租户门店",
      idempotencyKey: newKey("ADJ-CROSS-TENANT-STORE"),
    }),
    /门店.*不属于当前租户/,
  );
  await assert.rejects(
    adjust(scopeOf(tenant.id, otherStore.id), {
      batchId: mainBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "跨店批次",
      idempotencyKey: newKey("ADJ-CROSS-STORE"),
    }),
    /库存批次.*不属于当前门店/,
  );
  await assert.rejects(
    adjust(scope, {
      batchId: foreignBatch.id,
      locationId: locationOtherTenant.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "跨租户批次",
      idempotencyKey: newKey("ADJ-CROSS-TENANT-BATCH"),
    }),
    /库存批次.*不属于当前门店/,
  );

  // Concurrent same-key retries serialize on the batch lock and apply exactly once.
  const raceBatch = await db.inventoryBatch.create({
    data: { storeId: store.id, materialId: material.id, batchNo: `RACE-${marker}`, unitCost: 1 },
  });
  await db.batchBalance.create({
    data: { batchId: raceBatch.id, locationId: locationA.id, onHandQty: 5 },
  });
  const raceKey = newKey("ADJ-RACE");
  const raceResults = await Promise.all([
    adjust(scope, {
      batchId: raceBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "并发幂等",
      idempotencyKey: raceKey,
    }),
    adjust(scope, {
      batchId: raceBatch.id,
      locationId: locationA.id,
      mode: "INCREASE",
      quantity: 1,
      reason: "并发幂等",
      idempotencyKey: raceKey,
    }),
  ]);
  assert.equal(raceResults.filter((result) => result.idempotent).length, 1);
  assert.equal(raceResults.filter((result) => !result.idempotent).length, 1);
  assert.equal(await balanceQty(raceBatch.id, locationA.id), 6);
  assert.equal(await db.inventoryTransaction.count({ where: { idempotencyKey: raceKey } }), 1);
  assert.equal(await db.auditEvent.count({ where: { action: "INVENTORY_ADJUSTED", entityId: raceResults[0].transactionId } }), 1);

  console.log("v2 inventory-operations tests passed");
}

async function cleanup() {
  if (tenantIds.length === 0) return;
  const tenantFilter = { tenantId: { in: tenantIds } };
  const storeFilter = { store: { tenantId: { in: tenantIds } } };
  await db.auditEvent.deleteMany({ where: tenantFilter });
  await db.inventoryTransaction.deleteMany({ where: { batch: storeFilter } });
  await db.batchBalance.deleteMany({ where: { batch: storeFilter } });
  await db.inventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.sampleInventoryReservation.deleteMany({ where: { batch: storeFilter } });
  await db.inventoryBatch.deleteMany({ where: storeFilter });
  await db.material.deleteMany({ where: tenantFilter });
  await db.inventoryLocation.deleteMany({ where: storeFilter });
  await db.store.deleteMany({ where: tenantFilter });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error("inventory-operations cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
