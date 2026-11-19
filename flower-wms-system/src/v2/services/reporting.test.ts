import assert from "node:assert/strict";
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma-v2/client";
import { resolveReportRange } from "../domain/reporting";
import {
  loadCostSnapshotReport,
  loadInventoryReport,
  loadLossReport,
  loadOverviewReport,
  loadProductMarginReport,
  loadPurchaseReport,
  loadSalesTrendReport,
} from "./reporting";

/**
 * Run through the managed database harness:
 *   npx tsx src/v2/services/reporting.test.ts
 *
 * Business Sprint 2 P2: every report tab must use V2 rows and the same date
 * range, allocate cost to items, apply signed CostAdjustment rows, and isolate
 * data by tenant/store.
 */

config({ quiet: true });
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.V2_DATABASE_URL ?? process.env.DATABASE_URL;
const marker = crypto.randomUUID().slice(0, 8).toUpperCase();

async function runDatabaseTest(): Promise<void> {
  if (!connectionString) {
    console.log("v2 reporting DB test skipped (no V2_DATABASE_URL/DATABASE_URL)");
    return;
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const tenant = await db.tenant.create({
      data: { slug: `sprint2-report-${marker.toLowerCase()}`, name: "P2 报表测试租户" },
    });
    const otherTenant = await db.tenant.create({
      data: { slug: `sprint2-report-other-${marker.toLowerCase()}`, name: "P2 报表他租户" },
    });
    const store = await db.store.create({
      data: { tenantId: tenant.id, code: "MAIN", name: "P2 报表测试店" },
    });
    const otherStore = await db.store.create({
      data: { tenantId: otherTenant.id, code: "MAIN", name: "P2 报表他租户店" },
    });
    const location = await db.inventoryLocation.create({
      data: { storeId: store.id, code: "STOCK", kind: "WAREHOUSE" },
    });
    const otherLocation = await db.inventoryLocation.create({
      data: { storeId: otherStore.id, code: "STOCK", kind: "WAREHOUSE" },
    });

    const rose = await db.material.create({
      data: {
        tenantId: tenant.id,
        code: `ROSE-${marker}`,
        name: "P2 红玫瑰",
        kind: "FLOWER",
        baseUnit: "支",
        standardUnitCost: 3,
        standardUsableRate: 0.8,
        safetyStockThreshold: 20,
      },
    });
    const otherRose = await db.material.create({
      data: {
        tenantId: otherTenant.id,
        code: `ROSE-${marker}`,
        name: "P2 他租户玫瑰",
        kind: "FLOWER",
        baseUnit: "支",
        standardUnitCost: 99,
      },
    });

    const product = await db.product.create({
      data: { tenantId: tenant.id, code: `P-${marker}`, name: "P2 花束", active: true },
    });
    const sku = await db.productSku.create({
      data: { productId: product.id, code: `S-${marker}`, name: "11 支", price: 120, active: true },
    });
    const otherProduct = await db.product.create({
      data: { tenantId: otherTenant.id, code: `P-${marker}`, name: "P2 他租户花束", active: true },
    });
    const otherSku = await db.productSku.create({
      data: { productId: otherProduct.id, code: `S-${marker}`, name: "11 支", price: 999, active: true },
    });

    const supplier = await db.supplier.create({
      data: { tenantId: tenant.id, code: `SUP-${marker}`, name: "P2 供应商" },
    });
    const purchaseOrder = await db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        supplierId: supplier.id,
        number: `PO-${marker}`,
        state: "RECEIVED",
        orderedAt: new Date("2026-11-02T02:00:00.000Z"),
        freightCost: 10,
        packagingCost: 2,
        lines: {
          create: {
            materialId: rose.id,
            orderedQty: 20,
            purchaseUnit: "支",
            expectedBaseQty: 20,
            unitPrice: 5,
          },
        },
      },
      include: { lines: true },
    });
    const purchaseLine = purchaseOrder.lines[0]!;
    const receipt = await db.goodsReceipt.create({
      data: {
        purchaseOrderId: purchaseOrder.id,
        storeId: store.id,
        receivedAt: new Date("2026-11-03T02:00:00.000Z"),
      },
    });
    const receiptLine = await db.goodsReceiptLine.create({
      data: {
        receiptId: receipt.id,
        purchaseLineId: purchaseLine.id,
        acceptedMaterialId: rose.id,
        disposition: "ACCEPTED",
        quantity: 20,
        baseUnit: "支",
        finalUnitCost: 5,
      },
    });
    const batch = await db.inventoryBatch.create({
      data: {
        storeId: store.id,
        materialId: rose.id,
        receiptLineId: receiptLine.id,
        batchNo: `B-${marker}`,
        receivedAt: new Date("2026-11-03T02:00:00.000Z"),
        usableUntil: new Date("2026-11-10T00:00:00.000Z"),
        unitCost: 5,
        costEstimated: false,
      },
    });
    await db.batchBalance.create({
      data: { batchId: batch.id, locationId: location.id, onHandQty: 8, frozenQty: 0 },
    });

    async function createOrder(
      number: string,
      revenue: number,
      materialCost: number,
      closedAt: Date,
      skuId: string,
      quantity: number,
      unitPrice: number,
    ) {
      return db.order.create({
        data: {
          tenantId: tenant.id,
          storeId: store.id,
          number,
          createdVia: "STAFF_PORTAL",
          sourceChannel: "test",
          commercialState: "CONFIRMED",
          fulfillmentState: "DELIVERED",
          deliveryAt: closedAt,
          items: {
            create: {
              kind: "STANDARD",
              skuId,
              nameSnapshot: "P2 花束",
              quantity,
              unitPrice,
            },
          },
          costSnapshots: {
            create: {
              revisionNo: 1,
              revenue,
              materialCost,
              packagingCost: 5,
              consumableCost: 1,
              laborCost: 4,
              deliveryCost: 2,
              platformCost: 0,
              attributedLossCost: 1,
              estimated: false,
              closedAt,
            },
          },
        },
        include: { items: true, costSnapshots: true },
      });
    }

    const orderOne = await createOrder(
      `ORD-${marker}-1`,
      120,
      40,
      new Date("2026-11-03T03:00:00.000Z"),
      sku.id,
      2,
      60,
    );
    const orderTwo = await createOrder(
      `ORD-${marker}-2`,
      100,
      60,
      new Date("2026-11-04T03:00:00.000Z"),
      sku.id,
      1,
      100,
    );
    // The latest revision must win, and the adjustment must be applied.
    await db.orderCostSnapshot.create({
      data: {
        orderId: orderOne.id,
        revisionNo: 2,
        revenue: 130,
        materialCost: 45,
        packagingCost: 5,
        consumableCost: 1,
        laborCost: 4,
        deliveryCost: 2,
        platformCost: 0,
        attributedLossCost: 1,
        estimated: false,
        closedAt: new Date("2026-11-03T04:00:00.000Z"),
      },
    });
    const latestSnapshot = await db.orderCostSnapshot.findFirstOrThrow({
      where: { orderId: orderOne.id },
      orderBy: { revisionNo: "desc" },
    });
    await db.costAdjustment.create({
      data: {
        orderId: orderOne.id,
        snapshotId: latestSnapshot.id,
        kind: "MATERIAL",
        amountDelta: 5,
        reason: "P2 测试批次成本补录",
      },
    });

    // Delivered order without a snapshot must be counted as a data gap when it
    // was handed over inside the selected range.
    const deliveredWithoutSnapshot = await db.order.create({
      data: {
        tenantId: tenant.id,
        storeId: store.id,
        number: `ORD-${marker}-3`,
        createdVia: "STAFF_PORTAL",
        sourceChannel: "test",
        commercialState: "CONFIRMED",
        fulfillmentState: "DELIVERED",
        deliveryAt: new Date("2026-11-05T03:00:00.000Z"),
        fulfillment: {
          create: {
            kind: "PICKUP",
            handedOverAt: new Date("2026-11-05T03:00:00.000Z"),
          },
        },
      },
    });

    // Other store data must never leak into the report.
    await db.order.create({
      data: {
        tenantId: otherTenant.id,
        storeId: otherStore.id,
        number: `ORD-${marker}-OTHER`,
        createdVia: "STAFF_PORTAL",
        sourceChannel: "test",
        commercialState: "CONFIRMED",
        fulfillmentState: "DELIVERED",
        items: {
          create: {
            kind: "STANDARD",
            skuId: otherSku.id,
            nameSnapshot: "他租户花束",
            quantity: 1,
            unitPrice: 999,
          },
        },
        costSnapshots: {
          create: {
            revisionNo: 1,
            revenue: 999,
            materialCost: 99,
            packagingCost: 0,
            consumableCost: 0,
            laborCost: 0,
            deliveryCost: 0,
            platformCost: 0,
            attributedLossCost: 0,
            estimated: false,
            closedAt: new Date("2026-11-03T03:00:00.000Z"),
          },
        },
      },
    });
    const otherBatch = await db.inventoryBatch.create({
      data: {
        storeId: otherStore.id,
        materialId: otherRose.id,
        batchNo: `B-${marker}-OTHER`,
        unitCost: 99,
      },
    });
    await db.batchBalance.create({
      data: { batchId: otherBatch.id, locationId: otherLocation.id, onHandQty: 100, frozenQty: 0 },
    });

    // Production usage and a loss record for the loss report.
    await db.productionTask.create({
      data: {
        orderItemId: orderOne.items[0]!.id,
        quantity: 2,
        state: "COMPLETED",
        completedAt: new Date("2026-11-03T05:00:00.000Z"),
        usages: {
          create: { batchId: batch.id, usedQty: 10, lostQty: 2, returnedQty: 0 },
        },
      },
    });
    await db.lossRecord.create({
      data: {
        storeId: store.id,
        batchId: batch.id,
        materialId: rose.id,
        locationId: location.id,
        orderId: orderOne.id,
        reason: "CARE_DAMAGE",
        quantity: 2,
        occurredAt: new Date("2026-11-03T06:00:00.000Z"),
      },
    });

    const range = resolveReportRange({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      now: new Date("2026-11-06T04:00:00.000Z"),
    });
    const scope = { tenantId: tenant.id, storeId: store.id };

    const overview = await loadOverviewReport(db, scope, range);
    assert.equal(overview.summary.paidOrderCount, 2);
    assert.equal(overview.summary.revenue, 230);
    // order1 latest: 45+5+1+4+2+0+1+5 adjustment = 63; order2: 60+5+1+4+2+0+1 = 73.
    assert.equal(overview.summary.totalCost, 136);
    assert.equal(overview.summary.grossProfit, 94);
    assert.equal(overview.summary.adjustmentTotal, 5);
    assert.equal(overview.summary.missingSnapshotOrderCount, 1);
    assert.equal(overview.recentSnapshots.find((row) => row.orderId === orderOne.id)?.revisionNo, 2);
    assert.equal(overview.recentSnapshots.find((row) => row.orderId === orderOne.id)?.materialCost, 50);
    assert.equal(overview.dailySales.reduce((sum, row) => sum + row.orderCount, 0), 2);
    assert.equal(overview.dailySales.length, 30);

    const sales = await loadSalesTrendReport(db, scope, range);
    assert.equal(sales.summary.revenue, 230);

    const products = await loadProductMarginReport(db, scope, range, 0.35);
    assert.equal(products.products.length, 1);
    assert.equal(products.products[0]!.skuId, sku.id);
    assert.equal(products.products[0]!.revenue, 220);
    assert.equal(products.products[0]!.allocatedCost, 136);
    assert.equal(products.lowMarginOrders.length, 1);
    assert.equal(products.lowMarginOrders[0]!.orderId, orderTwo.id);

    const cost = await loadCostSnapshotReport(db, scope, range);
    assert.equal(cost.snapshots.length, 2);
    assert.equal(cost.snapshots.find((row) => row.orderId === orderOne.id)?.adjustmentCount, 1);

    const inventory = await loadInventoryReport(db, scope, new Date("2026-11-06T04:00:00.000Z"));
    assert.equal(inventory.materialCount, 1);
    assert.equal(inventory.lowStockCount, 1);
    assert.equal(inventory.expiringBatchCount, 1);
    const roseRow = inventory.alerts.find((row) => row.materialId === rose.id)!;
    assert.equal(roseRow.onHandQty, 8);
    assert.equal(roseRow.threshold, 20);
    assert.equal(inventory.totalInventoryValue, 40);

    const loss = await loadLossReport(db, scope, range);
    assert.equal(loss.loss.totalQuantity, 2);
    assert.equal(loss.loss.estimatedCost, 10);
    assert.equal(loss.loss.materialUsage[0]!.quantityUsed, 10);
    assert.equal(loss.lossModelImpact.rawFlowerMaterialCost, 50);
    assert.equal(loss.lossModelImpact.lossAdjustedFlowerMaterialCost, 62.5);
    assert.equal(loss.revenue, 230);
    assert.equal(loss.truncation.lossRecords, false);
    assert.equal(loss.truncation.materialUsages, false);

    const purchase = await loadPurchaseReport(db, scope, range);
    assert.equal(purchase.orderCount, 1);
    assert.equal(purchase.orderedValue, 100);
    assert.equal(purchase.freightTotal, 10);
    assert.equal(purchase.packagingTotal, 2);
    assert.equal(purchase.otherFeeTotal, 0);
    assert.equal(purchase.feeTotal, 12);
    assert.equal(purchase.orderedValueWithFees, 112);
    assert.equal(purchase.receivedValue, 100);
    assert.equal(purchase.suppliers[0]!.supplierId, supplier.id);
    assert.equal(purchase.priceTrend[0]!.month, "2026-11");
    assert.equal(purchase.batchConversions[0]!.batchId, batch.id);

    assert.equal(deliveredWithoutSnapshot.id.length > 0, true);
    console.log("v2 reporting DB test passed");
  } finally {
    await db.$disconnect();
  }
}

runDatabaseTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
