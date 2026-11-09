import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LocationKind, MaterialKind, OrderEntry, PaymentKind, PaymentState, PrismaClient, RefundState,
} from "../../generated/prisma-v2/client";
import { recordManualPayment } from "./record-manual-payment";
import { recordRefund } from "./record-refund";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for payment tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let storeId: string | undefined;
let otherTenantId: string | undefined;
let otherStoreId: string | undefined;
let warehouseId: string | undefined;
let batchId: string | undefined;

type Owner = { tenantId: string; storeId: string };

async function createOrder(
  label: string,
  createdVia: OrderEntry = OrderEntry.STAFF_PORTAL,
  owner?: Owner,
): Promise<string> {
  assert.ok(tenantId && storeId);
  const unique = `${label}-${marker}-${crypto.randomUUID().slice(0, 6)}`;
  const order = await db.order.create({
    data: {
      tenantId: owner?.tenantId ?? tenantId,
      storeId: owner?.storeId ?? storeId,
      number: `MP-${unique}`,
      createdVia,
      sourceChannel: "线下收款测试",
    },
  });
  return order.id;
}

async function successfulPaymentCents(orderId: string): Promise<number> {
  const rows = await db.paymentTransaction.findMany({
    where: { orderId, state: PaymentState.SUCCEEDED },
  });
  return rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-payment-${marker}`, name: "Phase 1 收款测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 收款测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  const material = await db.material.create({
    data: {
      tenantId, code: `MP-MAT-${marker}`, name: "收款测试花材",
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId, materialId: material.id, batchNo: `MP-BATCH-${marker}`, unitCost: 2 },
  });
  batchId = batch.id;
  await db.batchBalance.create({ data: { batchId, locationId: warehouseId, onHandQty: 50 } });

  const otherTenant = await db.tenant.create({
    data: { slug: `phase1-payment-other-${marker}`, name: "Phase 1 收款隔离租户" },
  });
  otherTenantId = otherTenant.id;
  const otherStore = await db.store.create({
    data: { tenantId: otherTenant.id, code: "MAIN", name: "Phase 1 收款隔离店" },
  });
  otherStoreId = otherStore.id;

  const orderId = await createOrder("main");
  const orderBefore = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const balanceBefore = Number((await db.batchBalance.findFirstOrThrow({ where: { batchId } })).onHandQty);
  const inventoryTxBefore = await db.inventoryTransaction.count({ where: { batchId } });

  // A successful offline payment is recorded with its reference, actor and confirmation time.
  const first = await recordManualPayment(db, {
    tenantId, storeId, orderId,
    amount: "100.00", method: PaymentKind.CASH, externalReference: "收据-001",
    idempotencyKey: `MP-1-${marker}`, confirmedById: "staff-1",
  });
  assert.equal(first.state, PaymentState.SUCCEEDED);
  assert.equal(first.orderId, orderId);
  assert.equal(first.method, PaymentKind.CASH);
  assert.equal(Number(first.amount), 100);
  assert.equal(first.externalReference, "收据-001");
  assert.equal(first.confirmedById, "staff-1");
  assert.ok(first.confirmedAt);

  // No order state or inventory/production fact may change because a payment was recorded.
  const orderAfter = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(orderAfter.commercialState, orderBefore.commercialState);
  assert.equal(orderAfter.supplyState, orderBefore.supplyState);
  assert.equal(orderAfter.productionState, orderBefore.productionState);
  assert.equal(orderAfter.fulfillmentState, orderBefore.fulfillmentState);
  assert.equal(await db.inventoryTransaction.count({ where: { batchId } }), inventoryTxBefore);
  assert.equal(
    Number((await db.batchBalance.findFirstOrThrow({ where: { batchId } })).onHandQty),
    balanceBefore,
  );
  assert.equal(await db.inventoryReservation.count({ where: { requirement: { orderItem: { orderId } } } }), 0);

  // Exact replay is a no-op and returns the original row.
  const replay = await recordManualPayment(db, {
    tenantId, storeId, orderId,
    amount: 100, method: PaymentKind.CASH, externalReference: "收据-001",
    idempotencyKey: `MP-1-${marker}`, confirmedById: "staff-1",
  });
  assert.equal(replay.id, first.id);
  assert.equal(await db.paymentTransaction.count({ where: { orderId } }), 1);

  // Reusing the key with different content is rejected, never overwritten.
  for (const change of [
    { amount: 101, method: PaymentKind.CASH, externalReference: "收据-001", confirmedById: "staff-1" },
    { amount: 100, method: PaymentKind.CARD, externalReference: "收据-001", confirmedById: "staff-1" },
    { amount: 100, method: PaymentKind.CASH, externalReference: "收据-002", confirmedById: "staff-1" },
    { amount: 100, method: PaymentKind.CASH, externalReference: "收据-001", confirmedById: "staff-2" },
  ]) {
    await assert.rejects(recordManualPayment(db, {
      tenantId, storeId, orderId, idempotencyKey: `MP-1-${marker}`, ...change,
    }), /幂等键/);
  }
  assert.equal(await db.paymentTransaction.count({ where: { orderId } }), 1);

  // Amount and method validation happens before any row is written.
  const countBeforeInvalid = await db.paymentTransaction.count({ where: { orderId } });
  for (const [amount, pattern] of [
    [0, /必须为正数/],
    [-1, /必须为正数/],
    [10.001, /最多保留两位小数/],
    [Number.NaN, /有效数字/],
    [1_000_000_000_000, /超出可记录范围/],
  ] as const) {
    await assert.rejects(recordManualPayment(db, {
      tenantId, storeId, orderId, amount, method: PaymentKind.CASH,
      idempotencyKey: `MP-INVALID-${amount}-${marker}`,
    }), pattern);
  }
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId, amount: 1, method: PaymentKind.MINI_PROGRAM,
    idempotencyKey: `MP-ONLINE-${marker}`,
  }), /线下收款/);
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId, amount: 1, method: "BITCOIN",
    idempotencyKey: `MP-METHOD-${marker}`,
  }), /支付方式无效/);
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId, amount: 1, method: PaymentKind.CASH,
    idempotencyKey: "   ",
  }), /幂等键不能为空/);
  assert.equal(await db.paymentTransaction.count({ where: { orderId } }), countBeforeInvalid);

  // Tenant/store ownership, manual-order binding and non-disclosure.
  await assert.rejects(recordManualPayment(db, {
    tenantId: otherTenantId, storeId, orderId, amount: 1, method: PaymentKind.CASH,
    idempotencyKey: `MP-BAD-TENANT-${marker}`,
  }), /订单不存在/);
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId: otherStoreId, orderId, amount: 1, method: PaymentKind.CASH,
    idempotencyKey: `MP-BAD-STORE-${marker}`,
  }), /订单不存在/);
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId: crypto.randomUUID(), amount: 1, method: PaymentKind.CASH,
    idempotencyKey: `MP-MISSING-ORDER-${marker}`,
  }), /订单不存在/);

  const onlineOrderId = await createOrder("online", OrderEntry.MINI_PROGRAM);
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId: onlineOrderId, amount: 1, method: PaymentKind.CASH,
    idempotencyKey: `MP-ONLINE-ORDER-${marker}`,
  }), /人工订单/);

  const foreignOrderId = await createOrder("foreign", OrderEntry.STAFF_PORTAL, {
    tenantId: otherTenant.id, storeId: otherStore.id,
  });
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId: foreignOrderId, amount: 1, method: PaymentKind.CASH,
    idempotencyKey: `MP-FOREIGN-${marker}`,
  }), /订单不存在/);

  // A committed payment must not leak through the replay path to another tenant.
  const crossTenantKey = `MP-FOREIGN-REPLAY-${marker}`;
  const foreignPayment = await recordManualPayment(db, {
    tenantId: otherTenantId, storeId: otherStoreId, orderId: foreignOrderId,
    amount: 40, method: PaymentKind.BANK_TRANSFER, externalReference: "FOREIGN-1",
    idempotencyKey: crossTenantKey,
  });
  await assert.rejects(recordManualPayment(db, {
    tenantId, storeId, orderId: foreignOrderId, amount: 40,
    method: PaymentKind.BANK_TRANSFER, externalReference: "FOREIGN-1",
    idempotencyKey: crossTenantKey,
  }), { message: "订单不存在" });
  assert.equal(await db.paymentTransaction.count({ where: { id: foreignPayment.id } }), 1);
  const validForeignReplay = await recordManualPayment(db, {
    tenantId: otherTenantId, storeId: otherStoreId, orderId: foreignOrderId,
    amount: 40, method: PaymentKind.BANK_TRANSFER, externalReference: "FOREIGN-1",
    idempotencyKey: crossTenantKey,
  });
  assert.equal(validForeignReplay.id, foreignPayment.id);

  // Concurrent identical retries return one payment row.
  const concurrentOrderId = await createOrder("same-key");
  const sameKey = `MP-CONCURRENT-${marker}`;
  const sameKeyResults = await Promise.all([
    recordManualPayment(db, {
      tenantId, storeId, orderId: concurrentOrderId, amount: 25,
      method: PaymentKind.CASH, idempotencyKey: sameKey,
    }),
    recordManualPayment(db, {
      tenantId, storeId, orderId: concurrentOrderId, amount: 25,
      method: PaymentKind.CASH, idempotencyKey: sameKey,
    }),
  ]);
  assert.equal(sameKeyResults[0].id, sameKeyResults[1].id);
  assert.equal(await db.paymentTransaction.count({ where: { orderId: concurrentOrderId } }), 1);
  assert.equal(await successfulPaymentCents(concurrentOrderId), 2_500);

  // The existing refund service can refund part of the recorded payment without rewriting it.
  const refund = await recordRefund(db, {
    tenantId, storeId, orderId, paymentId: first.id, amount: 30,
    reason: "客户部分退款", externalReference: "退款-001",
    idempotencyKey: `MP-REFUND-${marker}`,
  });
  assert.equal(refund.state, RefundState.SUCCEEDED);
  assert.equal(Number(refund.amount), 30);
  assert.equal(refund.paymentId, first.id);
  const originalAfterRefund = await db.paymentTransaction.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(originalAfterRefund.state, PaymentState.SUCCEEDED);
  assert.equal(Number(originalAfterRefund.amount), 100);
  assert.equal(originalAfterRefund.idempotencyKey, `MP-1-${marker}`);
  assert.equal(await db.paymentTransaction.count({ where: { orderId } }), 1);

  console.log("v2 record-manual-payment tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId, otherTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.refundTransaction.deleteMany({ where: { order: tenants } });
  await db.paymentTransaction.deleteMany({ where: { order: tenants } });
  await db.costAdjustment.deleteMany({ where: { order: tenants } });
  await db.orderCostSnapshot.deleteMany({ where: { order: tenants } });
  await db.lossRecord.deleteMany({ where: { store: tenants } });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.inventoryLocation.deleteMany({ where: { store: tenants } });
  await db.material.deleteMany({ where: tenants });
  await db.store.deleteMany({ where: tenants });
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
      console.error("record-manual-payment cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
