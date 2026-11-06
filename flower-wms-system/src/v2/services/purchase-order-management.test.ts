import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  MaterialKind, PrismaClient, PurchaseState,
} from "../../generated/prisma-v2-draft/client";
import { confirmManualOrder, createManualOrder } from "./manual-order";
import {
  createLinkedPurchaseOrder,
  linkedPurchaseOrderNumber,
  purchaseDraftTotal,
} from "./purchase-order-management";

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

assert.equal(purchaseDraftTotal([{ quantity: 10, unitPrice: 2.5 }, { quantity: 3, unitPrice: 4 }], { freightCost: 5, packagingCost: 2, otherCost: 1 }), 45);
assert.equal(purchaseDraftTotal([], { freightCost: 1.25, packagingCost: 2.5, otherCost: 3.75 }), 7.5);

// The linked-purchase number is a deterministic, trimmed digest of the idempotency key.
const deterministic = linkedPurchaseOrderNumber("  requirement-123:create  ");
assert.equal(deterministic, linkedPurchaseOrderNumber("requirement-123:create"));
assert.match(deterministic, /^PO-LINK-[0-9A-F]{24}$/);
assert.equal(deterministic.length, "PO-LINK-".length + 24);
assert.notEqual(deterministic, linkedPurchaseOrderNumber("requirement-123:create:2"));
assert.notEqual(linkedPurchaseOrderNumber("a"), linkedPurchaseOrderNumber("b"));
assert.throws(() => linkedPurchaseOrderNumber("   "), /幂等键不能为空/);

console.log("v2 purchase order management pure tests passed");

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8);
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

let tenantId: string | undefined;
let storeId: string | undefined;

async function latestRequirement(db: PrismaClient, orderId: string, materialId: string) {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      revisions: { orderBy: { number: "desc" }, take: 1 },
      items: { include: { requirements: true } },
    },
  });
  const latestRevision = order.revisions[0];
  assert.ok(latestRevision);
  const requirement = order.items
    .flatMap((item) => item.requirements)
    .find((entry) => entry.revisionId === latestRevision.id && entry.materialId === materialId);
  assert.ok(requirement);
  return requirement;
}

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 linked purchase order DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `phase1-linked-purchase-${marker}`, name: "Phase 1 关联采购测试租户" },
    });
    tenantId = tenant.id;
    const store = await db.store.create({
      data: { tenantId, code: "MAIN", name: "Phase 1 关联采购测试店" },
    });
    storeId = store.id;
    const material = await db.material.create({
      data: {
        tenantId, code: `LINK-MAT-${marker}`, name: "关联采购测试花材",
        kind: MaterialKind.FLOWER, baseUnit: "支", quantityScale: 1,
      },
    });
    const product = await db.product.create({
      data: { tenantId, code: `LINK-PROD-${marker}`, name: "关联采购测试花束" },
    });
    const sku = await db.productSku.create({
      data: {
        productId: product.id, code: `LINK-SKU-${marker}`, name: "标准款", price: 99,
        estimatedConsumableCost: 1, estimatedLaborCost: 2, active: true,
      },
    });
    await db.product.update({ where: { id: product.id }, data: { active: true, defaultSkuId: sku.id } });
    const recipe = await db.recipe.create({ data: { skuId: sku.id } });
    await db.recipeVersion.create({
      data: {
        recipeId: recipe.id, versionNo: 1, state: "PUBLISHED", publishedAt: new Date(),
        lines: { create: { materialId: material.id, plannedQty: 5 } },
      },
    });
    const supplier = await db.supplier.create({
      data: { tenantId, code: `LINK-SUP-${marker}`, name: "关联采购测试供应商", active: true },
    });
    const orderId = await createManualOrder(db, {
      tenantId, storeId, skuId: sku.id, quantity: 1,
      deliveryAt: futureDate(3), fulfillmentKind: "PICKUP", buyerName: "关联采购测试顾客",
    });
    const confirmation = await confirmManualOrder(db, orderId, tenantId, storeId);
    assert.equal(confirmation.covered, false);
    assert.ok(confirmation.totalShortage > 0);
    const requirement = await latestRequirement(db, orderId, material.id);

    const scope = { tenantId, storeId, actorStaffId: "staff-linked-purchase-test" };
    const idempotencyKey = `LINK-${marker}-primary`;
    const input = {
      supplierId: supplier.id,
      expectedAt: futureDate(1),
      quantity: 5,
      unitPrice: 1.5,
      freightCost: 0,
      packagingCost: 0,
      otherCost: 0,
      notes: "关联采购测试",
      requirementId: requirement.id,
      allocationQuantity: 2.5,
      idempotencyKey,
    };

    const first = await db.$transaction((tx) => createLinkedPurchaseOrder(tx, scope, input));
    assert.equal(first.idempotent, false);
    assert.equal(first.number, linkedPurchaseOrderNumber(idempotencyKey));
    assert.equal(first.allocatedQty, 2.5);
    assert.equal(first.remainingShortage, 2.5);
    assert.equal(first.baseUnit, "支");

    const created = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: first.purchaseOrderId },
      include: { lines: { include: { allocations: true } } },
    });
    assert.equal(created.storeId, storeId);
    assert.equal(created.state, PurchaseState.ORDERED);
    assert.equal(created.lines.length, 1);
    assert.equal(created.lines[0].materialId, material.id);
    assert.equal(Number(created.lines[0].orderedQty), 5);
    assert.equal(Number(created.lines[0].unitPrice), 1.5);
    assert.equal(created.lines[0].allocations.length, 1);
    assert.equal(Number(created.lines[0].allocations[0].allocatedQty), 2.5);

    // A repeat submit with the same key reuses the order, line and allocation without writing.
    const retry = await db.$transaction((tx) => createLinkedPurchaseOrder(tx, scope, input));
    assert.equal(retry.idempotent, true);
    assert.equal(retry.purchaseOrderId, first.purchaseOrderId);
    assert.equal(retry.purchaseLineId, first.purchaseLineId);
    assert.equal(retry.allocatedQty, 2.5);
    assert.equal(await db.purchaseOrder.count({ where: { tenantId, number: first.number } }), 1);
    assert.equal(await db.purchaseDemandAllocation.count({ where: { requirementId: requirement.id } }), 1);

    // A different key is a separate formal purchase order with its own allocation.
    const second = await db.$transaction((tx) => createLinkedPurchaseOrder(tx, scope, {
      ...input,
      idempotencyKey: `${idempotencyKey}-second`,
      quantity: 3,
      allocationQuantity: 1.5,
    }));
    assert.equal(second.idempotent, false);
    assert.notEqual(second.purchaseOrderId, first.purchaseOrderId);
    assert.notEqual(second.number, first.number);
    assert.equal(second.remainingShortage, 1);
    assert.equal(await db.purchaseOrder.count({ where: { tenantId } }), 2);
    assert.equal(await db.purchaseDemandAllocation.count({ where: { requirementId: requirement.id } }), 2);

    // A late expected arrival fails inside the transaction after the draft is written, so the
    // caller transaction rolls the draft back instead of leaving an unlinked purchase order.
    const lateKey = `${idempotencyKey}-late`;
    await assert.rejects(
      db.$transaction((tx) => createLinkedPurchaseOrder(tx, scope, {
        ...input,
        idempotencyKey: lateKey,
        expectedAt: futureDate(30),
        quantity: 5,
        allocationQuantity: 1,
      })),
      /预计到货时间/,
    );
    assert.equal(await db.purchaseOrder.count({ where: { tenantId } }), 2);
    assert.equal(await db.purchaseOrder.count({ where: { tenantId, number: linkedPurchaseOrderNumber(lateKey) } }), 0);

    console.log("v2 linked purchase order DB test passed");
  } finally {
    await cleanup(db);
    await db.$disconnect();
  }
}

async function cleanup(db: PrismaClient): Promise<void> {
  const tenantIds = [tenantId].filter((id): id is string => Boolean(id));
  if (tenantIds.length === 0) return;
  const tenants = { tenantId: { in: tenantIds } };
  await db.auditEvent.deleteMany({ where: tenants });
  await db.futureSupplyAllocation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.purchaseDemandAllocation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.inventoryReservation.deleteMany({ where: { requirement: { orderItem: { order: tenants } } } });
  await db.availabilityHoldMaterial.deleteMany({ where: { hold: { order: tenants } } });
  await db.availabilityHold.deleteMany({ where: { order: tenants } });
  await db.productionTask.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.fulfillment.deleteMany({ where: { order: tenants } });
  await db.orderMaterialRequirement.deleteMany({ where: { orderItem: { order: tenants } } });
  await db.orderItem.deleteMany({ where: { order: tenants } });
  await db.orderRevision.deleteMany({ where: { order: tenants } });
  await db.order.deleteMany({ where: tenants });
  await db.inventoryTransaction.deleteMany({ where: { batch: { store: tenants } } });
  await db.batchBalance.deleteMany({ where: { batch: { store: tenants } } });
  await db.inventoryBatch.deleteMany({ where: { store: tenants } });
  await db.goodsReceiptLine.deleteMany({ where: { receipt: { store: tenants } } });
  await db.goodsReceipt.deleteMany({ where: { store: tenants } });
  await db.purchaseOrderLine.deleteMany({ where: { purchaseOrder: tenants } });
  await db.purchaseOrder.deleteMany({ where: tenants });
  await db.supplier.deleteMany({ where: tenants });
  await db.recipeLine.deleteMany({ where: { version: { recipe: { sku: { product: tenants } } } } });
  await db.recipeVersion.deleteMany({ where: { recipe: { sku: { product: tenants } } } });
  await db.recipe.deleteMany({ where: { sku: { product: tenants } } });
  await db.product.updateMany({ where: tenants, data: { defaultSkuId: null } });
  await db.productSku.deleteMany({ where: { product: tenants } });
  await db.product.deleteMany({ where: tenants });
  await db.material.deleteMany({ where: tenants });
  await db.inventoryLocation.deleteMany({ where: { store: tenants } });
  await db.store.deleteMany({ where: tenants });
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

runDatabaseTest()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
