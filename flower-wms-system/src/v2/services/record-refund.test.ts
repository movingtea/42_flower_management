import { config } from "dotenv";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CommercialState, FulfillmentState, LocationKind, LossReason, MaterialKind, OrderEntry,
  PaymentKind, PaymentState, PrismaClient, ProductionState, RefundState, TransactionKind,
} from "../../generated/prisma-v2/client";
import { recordRefund } from "./record-refund";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL or DATABASE_URL is required for refund tests");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const marker = crypto.randomUUID().slice(0, 8);

let tenantId: string | undefined;
let storeId: string | undefined;
let otherTenantId: string | undefined;
let otherStoreId: string | undefined;
let warehouseId: string | undefined;
let batchId: string | undefined;

type OrderWithPayment = { orderId: string; paymentId: string };

async function createOrderWithPayment(
  label: string,
  amount: string,
  state: PaymentState = PaymentState.SUCCEEDED,
  target?: { tenantId: string; storeId: string },
): Promise<OrderWithPayment> {
  assert.ok(tenantId && storeId);
  const ownerTenant = target?.tenantId ?? tenantId;
  const ownerStore = target?.storeId ?? storeId;
  const unique = `${label}-${marker}-${crypto.randomUUID().slice(0, 6)}`;
  const order = await db.order.create({
    data: {
      tenantId: ownerTenant,
      storeId: ownerStore,
      number: `RF-${unique}`,
      createdVia: OrderEntry.STAFF_PORTAL,
      sourceChannel: "退款测试",
      commercialState: CommercialState.CONFIRMED,
      productionState: ProductionState.IN_PROGRESS,
      fulfillmentState: FulfillmentState.WAITING_DELIVERY,
    },
  });
  const payment = await db.paymentTransaction.create({
    data: {
      orderId: order.id,
      method: PaymentKind.CASH,
      state,
      amount,
      idempotencyKey: `PAY-${unique}`,
      confirmedAt: state === PaymentState.SUCCEEDED ? new Date() : null,
    },
  });
  return { orderId: order.id, paymentId: payment.id };
}

async function successfulRefundCents(paymentId: string): Promise<number> {
  const rows = await db.refundTransaction.findMany({
    where: { paymentId, state: RefundState.SUCCEEDED },
  });
  return rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
}

async function main() {
  const tenant = await db.tenant.create({
    data: { slug: `phase1-refund-${marker}`, name: "Phase 1 退款测试租户" },
  });
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, code: "MAIN", name: "Phase 1 退款测试店" },
  });
  storeId = store.id;
  const warehouse = await db.inventoryLocation.create({
    data: { storeId, code: "STOCK", kind: LocationKind.WAREHOUSE },
  });
  warehouseId = warehouse.id;
  const material = await db.material.create({
    data: {
      tenantId, code: `RF-MAT-${marker}`, name: "退款测试花材",
      kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 0,
    },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId, materialId: material.id, batchNo: `RF-BATCH-${marker}`, unitCost: 2 },
  });
  batchId = batch.id;
  await db.batchBalance.create({ data: { batchId, locationId: warehouseId, onHandQty: 50 } });

  const otherTenant = await db.tenant.create({
    data: { slug: `phase1-refund-other-${marker}`, name: "Phase 1 退款隔离租户" },
  });
  otherTenantId = otherTenant.id;
  const otherStore = await db.store.create({
    data: { tenantId: otherTenant.id, code: "MAIN", name: "Phase 1 退款隔离店" },
  });
  otherStoreId = otherStore.id;

  // Main order: payment 100, an immutable snapshot and inventory/production facts that must stay.
  const main = await createOrderWithPayment("main", "100.00");
  const snapshot = await db.orderCostSnapshot.create({
    data: {
      orderId: main.orderId, revisionNo: 1, revenue: "100.00", materialCost: "20.00",
      packagingCost: "0.00", consumableCost: "0.00", laborCost: "0.00", deliveryCost: "0.00",
      platformCost: "0.00", attributedLossCost: "0.00", estimated: false,
    },
  });
  const loss = await db.lossRecord.create({
    data: {
      storeId, batchId, orderId: main.orderId, reason: LossReason.PRODUCTION_ERROR, quantity: 1,
    },
  });
  await db.inventoryTransaction.create({
    data: {
      batchId, kind: TransactionKind.CONSUME, quantity: 5, referenceType: "TEST",
      referenceId: main.orderId, idempotencyKey: `TX-${marker}`,
    },
  });
  const balanceBefore = Number((await db.batchBalance.findFirstOrThrow({ where: { batchId } })).onHandQty);
  const snapshotBefore = await db.orderCostSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  const paymentBefore = await db.paymentTransaction.findUniqueOrThrow({ where: { id: main.paymentId } });

  const first = await recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 30, reason: "客户部分退款", idempotencyKey: `RF-1-${marker}`,
    externalReference: "EXT-1",
  });
  assert.equal(first.state, RefundState.SUCCEEDED);
  assert.equal(first.orderId, main.orderId);
  assert.equal(first.paymentId, main.paymentId);
  assert.equal(Number(first.amount), 30);
  assert.equal(first.reason, "客户部分退款");
  assert.equal(first.externalReference, "EXT-1");
  assert.ok(first.completedAt);

  const paymentAfter = await db.paymentTransaction.findUniqueOrThrow({ where: { id: main.paymentId } });
  assert.equal(paymentAfter.state, paymentBefore.state);
  assert.equal(Number(paymentAfter.amount), Number(paymentBefore.amount));
  assert.equal(paymentAfter.idempotencyKey, paymentBefore.idempotencyKey);
  const snapshotAfter = await db.orderCostSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
  assert.equal(Number(snapshotAfter.materialCost), Number(snapshotBefore.materialCost));
  assert.equal(Number(snapshotAfter.revenue), Number(snapshotBefore.revenue));
  assert.equal(snapshotAfter.closedAt.getTime(), snapshotBefore.closedAt.getTime());
  const orderAfter = await db.order.findUniqueOrThrow({ where: { id: main.orderId } });
  assert.equal(orderAfter.commercialState, CommercialState.CONFIRMED);
  assert.equal(orderAfter.productionState, ProductionState.IN_PROGRESS);
  assert.equal(await db.lossRecord.count({ where: { id: loss.id } }), 1);
  assert.equal(await db.inventoryTransaction.count({ where: { batchId } }), 1);
  assert.equal(
    Number((await db.batchBalance.findFirstOrThrow({ where: { batchId } })).onHandQty),
    balanceBefore,
  );

  // Exact replay is a no-op and returns the original row.
  const replay = await recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 30, reason: "客户部分退款", idempotencyKey: `RF-1-${marker}`,
    externalReference: "EXT-1",
  });
  assert.equal(replay.id, first.id);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: main.paymentId } }), 1);

  // Same key with different content is rejected, never overwritten.
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 31, reason: "客户部分退款", idempotencyKey: `RF-1-${marker}`,
    externalReference: "EXT-1",
  }), /幂等键/);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 30, reason: "其他原因", idempotencyKey: `RF-1-${marker}`,
    externalReference: "EXT-1",
  }), /幂等键/);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: main.paymentId } }), 1);
  assert.equal(await successfulRefundCents(main.paymentId), 3_000);

  // Partial refunds accumulate, the cap is enforced, and an exact remaining refund is allowed.
  await recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 50, reason: "第二次部分退款", idempotencyKey: `RF-2-${marker}`,
  });
  assert.equal(await successfulRefundCents(main.paymentId), 8_000);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 30, reason: "超过剩余金额", idempotencyKey: `RF-3-${marker}`,
  }), /累计退款金额/);
  assert.equal(await successfulRefundCents(main.paymentId), 8_000);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: main.paymentId } }), 2);
  await recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 20, reason: "退完剩余金额", idempotencyKey: `RF-4-${marker}`,
  });
  assert.equal(await successfulRefundCents(main.paymentId), 10_000);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 0.01, reason: "已无剩余金额", idempotencyKey: `RF-5-${marker}`,
  }), /累计退款金额/);
  assert.equal(await successfulRefundCents(main.paymentId), 10_000);

  // Amount and reason validation happens before any row is written.
  const countBeforeInvalid = await db.refundTransaction.count({ where: { paymentId: main.paymentId } });
  for (const [amount, pattern] of [
    [0, /必须为正数/],
    [-1, /必须为正数/],
    [10.001, /最多保留两位小数/],
    [Number.NaN, /有效数字/],
  ] as const) {
    await assert.rejects(recordRefund(db, {
      tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
      amount, reason: "非法金额", idempotencyKey: `RF-INVALID-${amount}-${marker}`,
    }), pattern);
  }
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 1, reason: "   ", idempotencyKey: `RF-EMPTY-REASON-${marker}`,
  }), /退款原因不能为空/);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 1, reason: "空幂等键", idempotencyKey: " ",
  }), /幂等键不能为空/);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: main.paymentId } }), countBeforeInvalid);

  // Tenant/store ownership and payment/order binding.
  await assert.rejects(recordRefund(db, {
    tenantId: otherTenantId, storeId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 1, reason: "错误租户", idempotencyKey: `RF-BAD-TENANT-${marker}`,
  }), /订单不存在/);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId: otherStoreId, orderId: main.orderId, paymentId: main.paymentId,
    amount: 1, reason: "错误门店", idempotencyKey: `RF-BAD-STORE-${marker}`,
  }), /订单不存在/);
  const foreign = await createOrderWithPayment("foreign", "40.00", PaymentState.SUCCEEDED, {
    tenantId: otherTenantId, storeId: otherStoreId,
  });
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: foreign.orderId, paymentId: foreign.paymentId,
    amount: 1, reason: "跨租户退款", idempotencyKey: `RF-FOREIGN-${marker}`,
  }), /订单不存在/);

  // A committed refund must not leak through the replay fast path just because the caller knows
  // the exact order, payment, amount, reason and idempotency key. The refund's own order must still
  // belong to the caller's tenant and store; the error must match a normal ownership failure.
  const crossTenantKey = `RF-FOREIGN-REPLAY-${marker}`;
  const foreignRefund = await recordRefund(db, {
    tenantId: otherTenantId, storeId: otherStoreId, orderId: foreign.orderId,
    paymentId: foreign.paymentId, amount: 10, reason: "跨租户幂等键",
    idempotencyKey: crossTenantKey,
  });
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: foreign.orderId, paymentId: foreign.paymentId,
    amount: 10, reason: "跨租户幂等键", idempotencyKey: crossTenantKey,
  }), { message: "订单不存在" });
  await assert.rejects(recordRefund(db, {
    tenantId: otherTenantId, storeId, orderId: foreign.orderId, paymentId: foreign.paymentId,
    amount: 10, reason: "跨租户幂等键", idempotencyKey: crossTenantKey,
  }), { message: "订单不存在" });
  assert.equal(await db.refundTransaction.count({ where: { paymentId: foreign.paymentId } }), 1);
  const validForeignReplay = await recordRefund(db, {
    tenantId: otherTenantId, storeId: otherStoreId, orderId: foreign.orderId,
    paymentId: foreign.paymentId, amount: 10, reason: "跨租户幂等键",
    idempotencyKey: crossTenantKey,
  });
  assert.equal(validForeignReplay.id, foreignRefund.id);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: foreign.paymentId } }), 1);

  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: foreign.paymentId,
    amount: 1, reason: "支付不属于订单", idempotencyKey: `RF-WRONG-PAYMENT-${marker}`,
  }), /支付记录不属于该订单/);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: main.orderId, paymentId: crypto.randomUUID(),
    amount: 1, reason: "支付不存在", idempotencyKey: `RF-MISSING-PAYMENT-${marker}`,
  }), /支付记录不存在/);

  // Only a succeeded payment may be refunded.
  const pending = await createOrderWithPayment("pending", "40.00", PaymentState.PENDING);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: pending.orderId, paymentId: pending.paymentId,
    amount: 1, reason: "未成功支付", idempotencyKey: `RF-PENDING-${marker}`,
  }), /仅成功的支付/);
  const failed = await createOrderWithPayment("failed", "40.00", PaymentState.FAILED);
  await assert.rejects(recordRefund(db, {
    tenantId, storeId, orderId: failed.orderId, paymentId: failed.paymentId,
    amount: 1, reason: "支付失败", idempotencyKey: `RF-FAILED-${marker}`,
  }), /仅成功的支付/);
  assert.equal(await db.refundTransaction.count({
    where: { paymentId: { in: [pending.paymentId, failed.paymentId] } },
  }), 0);

  // Concurrent identical retries return one refund row.
  const concurrent = await createOrderWithPayment("same-key", "100.00");
  const sameKey = `RF-CONCURRENT-${marker}`;
  const sameKeyResults = await Promise.all([
    recordRefund(db, {
      tenantId, storeId, orderId: concurrent.orderId, paymentId: concurrent.paymentId,
      amount: 25, reason: "并发同幂等键", idempotencyKey: sameKey,
    }),
    recordRefund(db, {
      tenantId, storeId, orderId: concurrent.orderId, paymentId: concurrent.paymentId,
      amount: 25, reason: "并发同幂等键", idempotencyKey: sameKey,
    }),
  ]);
  assert.equal(sameKeyResults[0].id, sameKeyResults[1].id);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: concurrent.paymentId } }), 1);
  assert.equal(await successfulRefundCents(concurrent.paymentId), 2_500);

  // Concurrent different refunds cannot both pass the cap check.
  const cap = await createOrderWithPayment("cap", "100.00");
  const capResults = await Promise.allSettled([
    recordRefund(db, {
      tenantId, storeId, orderId: cap.orderId, paymentId: cap.paymentId,
      amount: 60, reason: "并发退款 A", idempotencyKey: `RF-CAP-A-${marker}`,
    }),
    recordRefund(db, {
      tenantId, storeId, orderId: cap.orderId, paymentId: cap.paymentId,
      amount: 60, reason: "并发退款 B", idempotencyKey: `RF-CAP-B-${marker}`,
    }),
  ]);
  assert.equal(capResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(capResults.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await db.refundTransaction.count({ where: { paymentId: cap.paymentId } }), 1);
  assert.equal(await successfulRefundCents(cap.paymentId), 6_000);
  await recordRefund(db, {
    tenantId, storeId, orderId: cap.orderId, paymentId: cap.paymentId,
    amount: 40, reason: "补足剩余退款", idempotencyKey: `RF-CAP-C-${marker}`,
  });
  assert.equal(await successfulRefundCents(cap.paymentId), 10_000);

  console.log("v2 record-refund tests passed");
}

async function cleanup() {
  const tenantIds = [tenantId, otherTenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.costAdjustment.deleteMany({ where: { order: tenants } });
  await db.orderCostSnapshot.deleteMany({ where: { order: tenants } });
  await db.refundTransaction.deleteMany({ where: { order: tenants } });
  await db.paymentTransaction.deleteMany({ where: { order: tenants } });
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
      console.error("record-refund cleanup failed", error);
      process.exitCode = 1;
    }
    await db.$disconnect();
  });
