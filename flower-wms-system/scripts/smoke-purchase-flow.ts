/**
 * Manual smoke test:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/smoke-purchase-flow.ts
 *
 * Verifies purchase receive integration:
 * PurchaseOrder RECEIVED -> Batch -> StockLog INBOUND -> Material stock.
 */
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  FloralRole,
  Role,
  StockLogType,
  SupplierType,
} from "@/generated/prisma/enums";
import {
  createPurchaseOrder,
  receivePurchaseOrderWithTrustedOperator,
} from "@/services/purchase";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for smoke-purchase-flow");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function findOrCreateSmokeOperator() {
  const existing = await prisma.staffUser.findFirst({
    where: { isActive: true, role: { in: [Role.STORE_ADMIN, Role.WAREHOUSE_MANAGER] } },
    select: { id: true, username: true },
  });
  if (existing) {
    return { operatorStaffId: existing.id, operatorLabel: existing.username };
  }

  const username = "smoke-warehouse-manager";
  const staff = await prisma.staffUser.upsert({
    where: { username },
    create: {
      username,
      passwordHash: "smoke-only",
      role: Role.WAREHOUSE_MANAGER,
      displayName: "Smoke 仓管",
      isActive: true,
    },
    update: { isActive: true, role: Role.WAREHOUSE_MANAGER },
    select: { id: true, username: true },
  });
  return { operatorStaffId: staff.id, operatorLabel: staff.username };
}

async function findOrCreateSupplier() {
  const existing = await prisma.supplier.findFirst({
    where: { name: "Smoke 测试供应商", isActive: true },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      name: "Smoke 测试供应商",
      supplierType: SupplierType.LOCAL,
      contactName: "Smoke",
      isActive: true,
    },
    select: { id: true },
  });
}

async function findOrCreateFlowerWiki() {
  return prisma.flowerWiki.upsert({
    where: { englishName: "Smoke Purchase Rose" },
    create: {
      englishName: "Smoke Purchase Rose",
      chineseName: "Smoke采购玫瑰",
      floralRole: FloralRole.MAIN,
      maintenance: "Smoke test flower wiki record",
      defaultShelfLifeDays: 7,
    },
    update: { defaultShelfLifeDays: 7 },
    select: { id: true },
  });
}

async function main() {
  const [supplier, wiki, operator] = await Promise.all([
    findOrCreateSupplier(),
    findOrCreateFlowerWiki(),
    findOrCreateSmokeOperator(),
  ]);

  const purchaseOrder = await createPurchaseOrder({
    supplierId: supplier.id,
    purchaseDate: new Date().toISOString(),
    status: "ORDERED",
    shippingFee: "10",
    packagingFee: "5",
    otherFee: "0",
    allocationMethod: "BY_AMOUNT",
    note: "smoke purchase flow",
    lines: [
      {
        flowerWikiId: wiki.id,
        purchaseName: "Smoke采购玫瑰",
        purchaseQuantity: "2",
        purchaseUnit: "扎",
        stemsPerUnit: "10",
        unitPrice: "20",
      },
    ],
  });

  assert.equal(purchaseOrder.goodsAmount, "40.00");
  assert.equal(purchaseOrder.totalExtraFee, "15.00");
  assert.equal(purchaseOrder.lines[0].totalStems, "20.00");
  assert.equal(purchaseOrder.lines[0].actualTotalCost, "55.00");
  assert.equal(purchaseOrder.lines[0].actualUnitCost, "2.7500");

  const received = await receivePurchaseOrderWithTrustedOperator(purchaseOrder.id, {
    operator,
    receivedAt: new Date(),
  });

  assert.equal(received.purchaseOrder.status, "RECEIVED");
  assert.equal(received.createdBatches.length, 1);
  assert.equal(received.stockLogs.length, 1);

  const batch = received.createdBatches[0];
  const stockLog = received.stockLogs[0];
  assert.equal(batch.originalQty, 20);
  assert.equal(batch.remainingQty, 20);
  assert.equal(batch.unitCost, "2.7500");
  assert.ok(batch.batchNo, "batchNo should be generated");
  assert.equal(stockLog.type, StockLogType.INBOUND);
  assert.equal(stockLog.quantity, 20);
  assert.equal(stockLog.delta, 20);
  assert.match(stockLog.remark ?? "", new RegExp(purchaseOrder.purchaseNo));

  const material = await prisma.material.findFirst({
    where: { wikiId: wiki.id },
    include: {
      batches: { where: { id: batch.id } },
      stockLogs: { where: { id: stockLog.id } },
    },
  });
  assert.ok(material, "Material should be created or reused with wikiId");
  assert.equal(material.batches[0]?.remainingQty, 20);
  assert.equal(material.stockLogs[0]?.batchId, batch.id);

  console.log("[smoke-purchase-flow] OK", {
    purchaseNo: purchaseOrder.purchaseNo,
    batchNo: batch.batchNo,
    unitCost: batch.unitCost,
    stockLogId: stockLog.id,
  });
}

main()
  .catch((error) => {
    console.error("[smoke-purchase-flow] FAILED");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
