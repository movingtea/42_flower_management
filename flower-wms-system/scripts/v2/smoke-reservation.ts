import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { OrderEntry, OrderItemKind, PrismaClient, ReservationState } from "../../src/generated/prisma-v2-draft/client";
import { reserveOrderMaterial } from "../../src/v2/services/reserve-order-material";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "default" } });
  const store = await db.store.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: "MAIN" } } });
  const location = await db.inventoryLocation.findUniqueOrThrow({ where: { storeId_code: { storeId: store.id, code: "STOCK" } } });
  const marker = crypto.randomUUID().slice(0, 8);
  const material = await db.material.create({
    data: { tenantId: tenant.id, code: `TEST-ROSE-${marker}`, name: "A 级红玫瑰", kind: "FLOWER", grade: "A", color: "红", baseUnit: "支", quantityScale: 0 },
  });
  const batch = await db.inventoryBatch.create({
    data: { storeId: store.id, materialId: material.id, batchNo: `TEST-${marker}`, unitCost: 4.5 },
  });
  await db.batchBalance.create({ data: { batchId: batch.id, locationId: location.id, onHandQty: 10 } });

  async function makeRequirement(number: string) {
    const order = await db.order.create({
      data: { tenantId: tenant.id, storeId: store.id, number, createdVia: OrderEntry.STAFF_PORTAL, sourceChannel: "test" },
    });
    const item = await db.orderItem.create({
      data: { orderId: order.id, kind: OrderItemKind.CUSTOM, nameSnapshot: "测试花束", quantity: 1, unitPrice: 100 },
    });
    const revision = await db.orderRevision.create({ data: { orderId: order.id, number: 1 } });
    return db.orderMaterialRequirement.create({
      data: { orderItemId: item.id, revisionId: revision.id, materialId: material.id, plannedQty: 7, needBy: new Date(Date.now() + 86_400_000) },
    });
  }

  const [first, second] = await Promise.all([
    makeRequirement(`TEST-ORDER-${marker}-A`),
    makeRequirement(`TEST-ORDER-${marker}-B`),
  ]);
  const outcomes = await Promise.all([
    db.$transaction((tx) => reserveOrderMaterial(tx, first.id), { timeout: 15_000 }),
    db.$transaction((tx) => reserveOrderMaterial(tx, second.id), { timeout: 15_000 }),
  ]);
  assert.equal(outcomes.reduce((sum, value) => sum + value.reserved, 0), 10);
  assert.equal(outcomes.reduce((sum, value) => sum + value.shortage, 0), 4);
  const reservations = await db.inventoryReservation.findMany({ where: { batchId: batch.id, state: ReservationState.ACTIVE } });
  assert.equal(reservations.reduce((sum, row) => sum + Number(row.quantity), 0), 10);
  console.log("v2 concurrent reservation smoke passed", outcomes);
}

main().finally(() => db.$disconnect());
