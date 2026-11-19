import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma-v2/client";
import { completeDelivery } from "../../src/v2/services/complete-delivery";
import { completeProduction } from "../../src/v2/services/complete-production";
import { confirmManualOrder, createManualOrder } from "../../src/v2/services/manual-order";
import { receivePurchaseLine } from "../../src/v2/services/receive-purchase-line";

const connectionString = process.env.V2_DATABASE_URL;
if (!connectionString) throw new Error("V2_DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "default" } });
  const store = await db.store.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } } });
  const stock = await db.inventoryLocation.findUniqueOrThrow({ where: { storeId_code: { storeId: store.id, code: "STOCK" } } });
  const admin = await db.staffUser.findUniqueOrThrow({ where: { username: "admin" } });
  const marker = crypto.randomUUID().slice(0, 8);
  const material = await db.material.create({ data: { tenantId: tenant.id, code: `FLOW-${marker}`, name: "试单 A 级红玫瑰", kind: "FLOWER", grade: "A", baseUnit: "支" } });
  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, code: `SUP-${marker}`, name: "试单供应商" } });
  const purchase = await db.purchaseOrder.create({ data: { tenantId: tenant.id, storeId: store.id, supplierId: supplier.id, number: `PO-${marker}`, state: "ORDERED" } });
  const line = await db.purchaseOrderLine.create({ data: { purchaseOrderId: purchase.id, materialId: material.id, orderedQty: 10, purchaseUnit: "支", expectedBaseQty: 10, unitPrice: 5 } });
  const batchId = await db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenant.id, actorStaffId: admin.id,
    purchaseLineId: line.id, locationId: stock.id, acceptedMaterialId: material.id, quantity: 10,
    batchNo: `BATCH-${marker}`, disposition: "ACCEPTED", finalUnitCost: 5,
    idempotencyKey: `core-receipt-${marker}`,
  }));
  const product = await db.product.create({ data: { tenantId: tenant.id, code: `P-${marker}`, name: "试单玫瑰花束" } });
  const sku = await db.productSku.create({ data: { productId: product.id, code: `SKU-${marker}`, name: "标准款", price: 99, estimatedConsumableCost: 2, estimatedLaborCost: 3, active: true } });
  await db.product.update({ where: { id: product.id }, data: { active: true, defaultSkuId: sku.id } });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  await db.recipeVersion.create({ data: { recipeId: recipe.id, versionNo: 1, state: "PUBLISHED", publishedAt: new Date(), lines: { create: { materialId: material.id, plannedQty: 5 } } } });
  const orderId = await createManualOrder(db, {
    tenantId: tenant.id, storeId: store.id, skuId: sku.id, quantity: 1,
    deliveryAt: new Date(Date.now() + 2 * 86_400_000), buyerName: "试单顾客", fulfillmentKind: "PICKUP",
  });
  await db.productSku.update({ where: { id: sku.id }, data: { price: 199 } });
  const confirmed = await confirmManualOrder(db, orderId, tenant.id, store.id);
  assert.deepEqual(confirmed, { covered: true, totalShortage: 0 });
  await completeProduction(db, orderId, tenant.id, store.id);
  await completeDelivery(db, orderId, tenant.id, store.id, admin.id);
  const [order, balance, movements] = await Promise.all([
    db.order.findUniqueOrThrow({ where: { id: orderId }, include: { costSnapshots: true } }),
    db.batchBalance.findFirstOrThrow({ where: { batchId } }),
    db.inventoryTransaction.findMany({ where: { batchId } }),
  ]);
  assert.equal(order.fulfillmentState, "DELIVERED");
  assert.equal(Number(balance.onHandQty), 5);
  assert.equal(Number(order.costSnapshots[0]?.materialCost), 25);
  assert.equal(Number(order.costSnapshots[0]?.consumableCost), 2);
  assert.equal(Number(order.costSnapshots[0]?.laborCost), 3);
  assert.equal(Number(order.costSnapshots[0]?.revenue), 99);
  assert.deepEqual(movements.map((movement) => movement.kind).sort(), ["CONSUME", "INBOUND", "TRANSFER"]);
  console.log(`v2 core flow passed: ${order.number}`);
}

main().finally(() => db.$disconnect());
