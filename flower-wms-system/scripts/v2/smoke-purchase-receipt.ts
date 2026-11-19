import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma-v2/client";
import { receivePurchaseLine } from "../../src/v2/services/receive-purchase-line";
import { rejectPurchaseLine } from "../../src/v2/services/reject-purchase-line";

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "default" } });
  const store = await db.store.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } } });
  const location = await db.inventoryLocation.findUniqueOrThrow({ where: { storeId_code: { storeId: store.id, code: "STOCK" } } });
  const marker = crypto.randomUUID().slice(0, 8);
  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, code: `S-${marker}`, name: "测试供应商" } });
  const gradeA = await db.material.create({ data: { tenantId: tenant.id, code: `A-${marker}`, name: "A 级红玫瑰", kind: "FLOWER", grade: "A", baseUnit: "支" } });
  const gradeB = await db.material.create({ data: { tenantId: tenant.id, code: `B-${marker}`, name: "B 级红玫瑰", kind: "FLOWER", grade: "B", baseUnit: "支" } });
  const purchase = await db.purchaseOrder.create({ data: { tenantId: tenant.id, storeId: store.id, supplierId: supplier.id, number: `PO-${marker}`, state: "ORDERED" } });
  const line = await db.purchaseOrderLine.create({ data: { purchaseOrderId: purchase.id, materialId: gradeA.id, orderedQty: 10, purchaseUnit: "支", expectedBaseQty: 10, unitPrice: 5 } });

  // Legal sequence: 6 accepted + 2 rejected + 2 downgraded = 10.
  const first = await db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenant.id, actorStaffId: "smoke-staff",
    purchaseLineId: line.id, locationId: location.id, acceptedMaterialId: gradeA.id,
    quantity: 6, batchNo: `A-${marker}`, disposition: "ACCEPTED", finalUnitCost: 5,
    idempotencyKey: `RECEIPT-${marker}-A`,
  }));
  const rejected = await db.$transaction((tx) => rejectPurchaseLine(tx, {
    tenantId: tenant.id, storeId: store.id, actorStaffId: "smoke-staff",
    purchaseLineId: line.id, quantity: 2, reason: "花头损坏",
    idempotencyKey: `REJECT-${marker}-A`,
  }));
  assert.equal(rejected.progress.rejectedQty, 2);
  assert.equal(rejected.progress.processedQty, 8);
  assert.equal(rejected.progress.remainingQty, 2);
  assert.equal(rejected.progress.state, "PARTIALLY_RECEIVED");
  assert.equal(rejected.purchaseState, "PARTIALLY_RECEIVED");

  await assert.rejects(db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenant.id, actorStaffId: "smoke-staff",
    purchaseLineId: line.id, locationId: location.id, acceptedMaterialId: gradeA.id,
    quantity: 3, batchNo: `OVER-${marker}`, disposition: "ACCEPTED", finalUnitCost: 5,
    idempotencyKey: `RECEIPT-${marker}-OVER`,
  })), /累计处理数量将超过采购基础数量 10/);

  const second = await db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenant.id, actorStaffId: "smoke-staff",
    purchaseLineId: line.id, locationId: location.id, acceptedMaterialId: gradeB.id,
    quantity: 2, batchNo: `B-${marker}`, disposition: "DOWNGRADED",
    gradeChangeReason: "花头尺寸低于 A 级标准", finalUnitCost: 3.5,
    idempotencyKey: `RECEIPT-${marker}-B`,
  }));
  assert.equal((await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchase.id } })).state, "RECEIVED");
  const balances = await db.batchBalance.findMany({ where: { batchId: { in: [first, second] } } });
  const movements = await db.inventoryTransaction.findMany({ where: { batchId: { in: [first, second] } } });
  assert.equal(balances.reduce((sum, row) => sum + Number(row.onHandQty), 0), 8);
  assert.equal(movements.reduce((sum, row) => sum + Number(row.quantity), 0), 8);
  assert.equal(await db.inventoryBatch.count({ where: { receiptLine: { disposition: "REJECTED" } } }), 0);
  console.log("v2 split receipt and downgrade smoke passed");
}

main().finally(() => db.$disconnect());
