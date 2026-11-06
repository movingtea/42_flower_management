import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma-v2-draft/client";
import { confirmManualOrder, createManualOrder } from "../../src/v2/services/manual-order";
import { receivePurchaseLine } from "../../src/v2/services/receive-purchase-line";
import { recheckSupplyAfterReceipt } from "../../src/v2/services/recheck-supply";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "default" } });
  const store = await db.store.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } } });
  const stock = await db.inventoryLocation.findUniqueOrThrow({ where: { storeId_code: { storeId: store.id, code: "STOCK" } } });
  const admin = await db.staffUser.findUniqueOrThrow({ where: { username: "admin" } });
  const marker = crypto.randomUUID().slice(0, 8);
  const material = await db.material.create({ data: { tenantId: tenant.id, code: `SHORT-${marker}`, name: "缺货测试花材", kind: "FLOWER", baseUnit: "支" } });
  const product = await db.product.create({ data: { tenantId: tenant.id, code: `SHORT-P-${marker}`, name: "缺货测试花束" } });
  const sku = await db.productSku.create({ data: { productId: product.id, code: `SHORT-SKU-${marker}`, name: "标准款", price: 50, active: true } });
  await db.product.update({ where: { id: product.id }, data: { active: true, defaultSkuId: sku.id } });
  const recipe = await db.recipe.create({ data: { skuId: sku.id } });
  await db.recipeVersion.create({ data: { recipeId: recipe.id, versionNo: 1, state: "PUBLISHED", lines: { create: { materialId: material.id, plannedQty: 5 } } } });
  const orderId = await createManualOrder(db, { tenantId: tenant.id, storeId: store.id, skuId: sku.id, quantity: 1, deliveryAt: new Date(Date.now() + 2 * 86_400_000), fulfillmentKind: "PICKUP" });
  assert.deepEqual(await confirmManualOrder(db, orderId, tenant.id, store.id), { covered: false, totalShortage: 5 });
  let order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.commercialState, "PENDING_CONFIRMATION");
  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, code: `SHORT-S-${marker}`, name: "缺货测试供应商" } });
  const purchase = await db.purchaseOrder.create({ data: { tenantId: tenant.id, storeId: store.id, supplierId: supplier.id, number: `SHORT-PO-${marker}`, state: "ORDERED" } });
  const line = await db.purchaseOrderLine.create({ data: { purchaseOrderId: purchase.id, materialId: material.id, orderedQty: 5, purchaseUnit: "支", expectedBaseQty: 5, unitPrice: 2 } });
  await db.$transaction((tx) => receivePurchaseLine(tx, {
    tenantId: tenant.id, actorStaffId: admin.id,
    purchaseLineId: line.id, locationId: stock.id, acceptedMaterialId: material.id, quantity: 5,
    batchNo: `SHORT-B-${marker}`, disposition: "ACCEPTED", finalUnitCost: 2,
    idempotencyKey: `SHORT-R-${marker}`,
  }));
  assert.deepEqual(await recheckSupplyAfterReceipt(db, tenant.id, store.id, material.id), { checked: 1, failed: 0 });
  order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(order.commercialState, "CONFIRMED");
  assert.equal(order.supplyState, "ON_HAND_COVERED");
  console.log("v2 shortage recovery passed");
}

main().finally(() => db.$disconnect());
