import assert from "node:assert/strict";
import {
  applyCostAdjustments,
  buildDailySalesRows,
  buildInventoryReport,
  buildLossModelImpact,
  buildLossReport,
  buildLowMarginRows,
  buildOrderSnapshotRow,
  buildProductMarginRows,
  buildPurchaseReport,
  computeLossRate,
  formatReportQuantity,
  isLowStock,
  normalizeUsableRate,
  resolveReportRange,
  selectLatestSnapshotRows,
  summarizeSnapshots,
  type OrderSnapshotRow,
  type PurchaseLineInput,
} from "./reporting";

const NOW = new Date("2026-11-06T04:00:00.000Z"); // 2026-11-06 12:00 Asia/Shanghai

function snapshot(
  overrides: Partial<OrderSnapshotRow> & {
    adjustments?: Array<{ kind: string; amountDelta: number }>;
  } = {},
): OrderSnapshotRow {
  const { items = [], adjustments = [], ...base } = overrides;
  return {
    ...buildOrderSnapshotRow({
      orderId: "order-1",
      orderNumber: "ORD-1",
      revisionNo: 1,
      closedAt: new Date("2026-11-03T03:00:00.000Z"),
      estimated: false,
      commercialState: "CONFIRMED",
      revenue: 100,
      materialCost: 40,
      packagingCost: 10,
      consumableCost: 5,
      laborCost: 15,
      deliveryCost: 10,
      platformCost: 0,
      attributedLossCost: 0,
      adjustments,
      ...base,
    }),
    items,
  };
}

function testRanges() {
  const thisMonth = resolveReportRange({ preset: "thisMonth", now: NOW });
  assert.equal(thisMonth.startDate, "2026-11-01");
  assert.equal(thisMonth.endDate, "2026-11-06");
  assert.equal(thisMonth.label, "本月");

  const lastMonth = resolveReportRange({ preset: "lastMonth", now: NOW });
  assert.equal(lastMonth.startDate, "2026-10-01");
  assert.equal(lastMonth.endDate, "2026-10-31");
  assert.equal(lastMonth.endUtcExclusive.toISOString(), "2026-10-31T16:00:00.000Z");

  const customSwapped = resolveReportRange({
    startDate: "2026-11-05",
    endDate: "2026-11-01",
    now: NOW,
  });
  assert.equal(customSwapped.startDate, "2026-11-01");
  assert.equal(customSwapped.endDate, "2026-11-05");
  assert.equal(customSwapped.preset, null);

  const clamped = resolveReportRange({
    startDate: "2024-01-01",
    endDate: "2026-11-06",
    now: NOW,
  });
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.endDate, "2026-11-06");
  assert.equal(clamped.startDate, "2025-11-06");

  const invalid = resolveReportRange({ startDate: "not-a-date", preset: "nope", now: NOW });
  assert.equal(invalid.label, "本月");
  assert.equal(invalid.startDate, "2026-11-01");
}

function testAdjustmentsAndTotals() {
  const adjusted = applyCostAdjustments(
    {
      revenue: 100,
      materialCost: 40,
      packagingCost: 10,
      consumableCost: 5,
      laborCost: 15,
      deliveryCost: 10,
      platformCost: 0,
      attributedLossCost: 0,
    },
    [
      { kind: "MATERIAL", amountDelta: 2.5 },
      { kind: "LOSS", amountDelta: 1 },
      { kind: "UNKNOWN", amountDelta: 99 },
    ],
  );
  assert.equal(adjusted.materialCost, 42.5);
  assert.equal(adjusted.attributedLossCost, 1);
  assert.equal(adjusted.totalCost, 83.5);
  assert.equal(adjusted.grossProfit, 16.5);

  const row = snapshot({ adjustments: [{ kind: "DELIVERY", amountDelta: -2 }] });
  assert.equal(row.deliveryCost, 8);
  assert.equal(row.totalCost, 78);
  assert.equal(row.adjustmentCount, 1);
  assert.equal(row.adjustmentTotal, -2);

  const latest = selectLatestSnapshotRows([
    snapshot({ revisionNo: 1 }),
    snapshot({ revisionNo: 3 }),
    snapshot({ orderId: "order-2", orderNumber: "ORD-2", revisionNo: 1 }),
  ]);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((item) => item.orderId === "order-1")?.revisionNo, 3);

  const { summary, costStructure } = summarizeSnapshots(latest);
  assert.equal(summary.revenue, 200);
  assert.equal(summary.grossProfit, 40);
  assert.equal(summary.grossMargin, 0.2);
  assert.equal(summary.averageOrderValue, 100);
  assert.equal(costStructure.totalCost, 160);
  assert.equal(costStructure.ratios.materialCost, 0.5);
}

function testDailyAndProducts() {
  const range = resolveReportRange({ startDate: "2026-11-02", endDate: "2026-11-04", now: NOW });
  const rows = [
    snapshot({
      orderId: "o1",
      items: [
        { skuId: "sku-a", productName: "红玫瑰", skuName: "11 支", quantity: 2, unitPrice: 50 },
        { skuId: "sku-b", productName: "白玫瑰", skuName: "11 支", quantity: 1, unitPrice: 20 },
      ],
    }),
    snapshot({
      orderId: "o2",
      orderNumber: "ORD-2",
      closedAt: new Date("2026-11-03T17:00:00.000Z"),
      revenue: 50,
      materialCost: 20,
      packagingCost: 5,
      consumableCost: 0,
      laborCost: 5,
      deliveryCost: 0,
      platformCost: 0,
      attributedLossCost: 0,
      items: [{ skuId: "sku-a", productName: "红玫瑰", skuName: "11 支", quantity: 1, unitPrice: 50 }],
    }),
  ];
  const daily = buildDailySalesRows(rows, range);
  assert.deepEqual(daily.map((row) => row.date), ["2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.equal(daily[0].orderCount, 0);
  assert.equal(daily[1].orderCount, 1);
  // 17:00Z is 01:00 Shanghai on 2026-11-04.
  assert.equal(daily[2].orderCount, 1);
  assert.equal(daily[2].revenue, 50);

  const products = buildProductMarginRows(rows);
  const skuA = products.find((row) => row.skuId === "sku-a")!;
  assert.equal(skuA.quantity, 3);
  assert.equal(skuA.revenue, 150);
  // Cost allocated by item revenue: 80 × 100/120 of order 1 plus all of order 2.
  assert.equal(skuA.allocatedCost, 96.67);
  assert.equal(skuA.grossProfit, 53.33);
  // Product rows always add up to the snapshot total cost (rounding included).
  assert.equal(
    products.reduce((sum, row) => sum + row.allocatedCost, 0),
    summarizeSnapshots(rows).costStructure.totalCost,
  );

  const low = buildLowMarginRows(rows, 0.35);
  // order 1 margin = 20%; order 2 margin = 40%.
  assert.deepEqual(low.map((row) => row.orderId), ["o1"]);
  assert.equal(buildLowMarginRows(rows, 0.1).length, 0);
}

function testAllocationRounding() {
  // 0.01 split over two equal items must not lose the cent to rounding.
  const order = snapshot({
    orderId: "rounding",
    revenue: 2,
    materialCost: 0.01,
    packagingCost: 0,
    consumableCost: 0,
    laborCost: 0,
    deliveryCost: 0,
    platformCost: 0,
    attributedLossCost: 0,
    items: [
      { skuId: "sku-c", productName: "商品 C", skuName: "标准", quantity: 1, unitPrice: 1 },
      { skuId: "sku-d", productName: "商品 D", skuName: "标准", quantity: 1, unitPrice: 1 },
    ],
  });
  const products = buildProductMarginRows([order]);
  assert.equal(products.length, 2);
  assert.equal(
    products.reduce((sum, row) => sum + row.allocatedCost, 0),
    0.01,
  );
}

function testLossModelAndLossReport() {
  assert.equal(normalizeUsableRate(null), 0.85);
  assert.equal(normalizeUsableRate(80), 0.8);
  assert.equal(normalizeUsableRate(2), 0.1);
  assert.equal(normalizeUsableRate(100), 1);
  assert.equal(normalizeUsableRate(0), 0.85);
  assert.equal(normalizeUsableRate(-1), 0.85);

  const impact = buildLossModelImpact(
    [
      { materialId: "m1", materialName: "红玫瑰", usedQty: 10, unitCost: 2, usableRate: 0.8 },
      { materialId: "m1", materialName: "红玫瑰", usedQty: 5, unitCost: 2, usableRate: 0.8 },
      { materialId: "m2", materialName: "尤加利", usedQty: 10, unitCost: 1, usableRate: null },
    ],
    1000,
  );
  assert.equal(impact.rawFlowerMaterialCost, 40);
  assert.equal(impact.lossAdjustedFlowerMaterialCost, 37.5 + 11.76);
  assert.equal(impact.lossModelExtraCost, 9.26);
  assert.equal(impact.topMaterials[0].materialId, "m1");

  const loss = buildLossReport(
    [
      {
        id: "loss-1",
        occurredAt: new Date("2026-11-03T02:00:00.000Z"),
        reason: "CARE_DAMAGE",
        quantity: 2,
        materialName: "红玫瑰",
        baseUnit: "支",
        unitCost: 3,
        batchNo: "B-1",
        orderId: "o1",
        orderNumber: "ORD-1",
      },
      {
        id: "loss-2",
        occurredAt: new Date("2026-11-04T02:00:00.000Z"),
        reason: "EXPIRED",
        quantity: 1,
        materialName: "白玫瑰",
        baseUnit: "支",
        unitCost: 4,
        batchNo: null,
        orderId: null,
        orderNumber: null,
      },
    ],
    [
      { materialId: "m1", materialName: "红玫瑰", baseUnit: "支", usedQty: 10, lostQty: 2, returnedQty: 0, unitCost: 3, orderId: "o1" },
      { materialId: "m1", materialName: "红玫瑰", baseUnit: "支", usedQty: 5, lostQty: 0, returnedQty: 1, unitCost: 3, orderId: "o2" },
    ],
  );
  assert.equal(loss.totalQuantity, 3);
  assert.equal(loss.estimatedCost, 10);
  assert.equal(loss.byReason.length, 2);
  assert.equal(loss.materialUsage[0].quantityUsed, 15);
  assert.equal(loss.materialUsage[0].orderCount, 2);
  assert.equal(loss.materialUsage[0].averageUnitCost, 3);
}

function testInventory() {
  const now = new Date("2026-11-06T04:00:00.000Z");
  const report = buildInventoryReport(
    [
      {
        id: "m1",
        code: "M1",
        name: "红玫瑰",
        baseUnit: "支",
        safetyStockThreshold: 20,
        standardUnitCost: 3,
        batches: [
          { id: "b1", batchNo: "B1", usableUntil: new Date("2026-11-08T00:00:00.000Z"), unitCost: 3, onHandQty: 5, frozenQty: 0, reservedQty: 2 },
          { id: "b2", batchNo: "B2", usableUntil: new Date("2026-12-08T00:00:00.000Z"), unitCost: 3, onHandQty: 0, frozenQty: 0, reservedQty: 0 },
        ],
      },
      {
        id: "m2",
        code: "M2",
        name: "白玫瑰",
        baseUnit: "支",
        safetyStockThreshold: 0,
        standardUnitCost: 2,
        batches: [],
      },
      {
        id: "m3",
        code: "M3",
        name: "尤加利",
        baseUnit: "扎",
        safetyStockThreshold: 1,
        standardUnitCost: 8,
        batches: [
          { id: "b3", batchNo: "B3", usableUntil: null, unitCost: 8, onHandQty: 5, frozenQty: 1, reservedQty: 0 },
        ],
      },
    ],
    now,
  );
  assert.equal(report.materialCount, 3);
  assert.equal(report.outOfStockCount, 1);
  assert.equal(report.lowStockCount, 2);
  assert.equal(report.expiringBatchCount, 1);
  assert.equal(report.totalInventoryValue, 15 + 40);
  assert.deepEqual(report.alerts.map((row) => row.materialId), ["m2", "m1"]);
  assert.equal(report.alerts[1].availableQty, 3);
  assert.equal(report.alerts[1].reason, "低于安全库存 20支");
  assert.equal(report.expiring[0].batchNo, "B1");

  // A custom expiry window must be reflected in the alert reason text.
  const wideWindow = buildInventoryReport(
    [
      {
        id: "m4",
        code: "M4",
        name: "洋桔梗",
        baseUnit: "支",
        safetyStockThreshold: 0,
        standardUnitCost: 4,
        batches: [
          { id: "b4", batchNo: "B4", usableUntil: new Date("2026-12-01T00:00:00.000Z"), unitCost: 4, onHandQty: 3, frozenQty: 0, reservedQty: 0 },
        ],
      },
    ],
    now,
    30,
  );
  assert.equal(wideWindow.alerts[0].alertLevel, "EXPIRING");
  assert.equal(wideWindow.alerts[0].reason, "1 个批次 30 天内到期");
}

function testPurchase() {
  const line: PurchaseLineInput = {
    purchaseOrderId: "po1",
    purchaseNumber: "PO-1",
    supplierId: "s1",
    supplierName: "供应商 A",
    orderedAt: new Date("2026-11-03T02:00:00.000Z"),
    state: "PARTIALLY_RECEIVED",
    freightCost: 10,
    packagingCost: 2,
    otherCost: 0,
    materialId: "m1",
    materialCode: "M1",
    materialName: "红玫瑰",
    baseUnit: "支",
    orderedQty: 20,
    expectedBaseQty: 20,
    unitPrice: 5,
    receipts: [
      {
        disposition: "ACCEPTED",
        quantity: 10,
        receivedAt: new Date("2026-11-04T02:00:00.000Z"),
        finalUnitCost: 5,
        batch: { id: "b1", batchNo: "B1", unitCost: 5, onHandQty: 6, usedQty: 4 },
      },
      {
        disposition: "DOWNGRADED",
        quantity: 2,
        receivedAt: new Date("2026-11-04T02:00:00.000Z"),
        finalUnitCost: 4,
        batch: { id: "b2", batchNo: "B2", unitCost: 4, onHandQty: 2, usedQty: 0 },
      },
      {
        disposition: "REJECTED",
        quantity: 3,
        receivedAt: new Date("2026-11-04T02:00:00.000Z"),
        finalUnitCost: null,
        batch: null,
      },
    ],
  };
  const report = buildPurchaseReport([line]);
  assert.equal(report.orderCount, 1);
  assert.equal(report.orderedValue, 100);
  assert.equal(report.freightTotal, 10);
  assert.equal(report.packagingTotal, 2);
  assert.equal(report.otherFeeTotal, 0);
  assert.equal(report.feeTotal, 12);
  assert.equal(report.orderedValueWithFees, 112);
  assert.equal(report.receivedQty, 12);
  assert.equal(report.rejectedQty, 3);
  assert.equal(report.receivedValue, 58);
  assert.equal(report.suppliers[0].orderCount, 1);
  assert.equal(report.suppliers[0].rejectedRate, 0.2);
  assert.equal(report.priceTrend[0].month, "2026-11");
  assert.equal(report.priceTrend[0].averageUnitCost, 4.8333);
  const batch = report.batchConversions.find((row) => row.batchId === "b1")!;
  assert.equal(batch.conversionRate, 0.4);
  assert.equal(formatReportQuantity(1.5), "1.5");
  assert.equal(formatReportQuantity(2), "2");
  assert.equal(computeLossRate(5, 95), 0.05);
  assert.equal(computeLossRate(0, 0), 0);
  assert.equal(isLowStock(0, 0), true);
  assert.equal(isLowStock(1, 0), false);
  assert.equal(isLowStock(9, 10), true);
  assert.equal(isLowStock(10, 10), false);
}

function run() {
  testRanges();
  testAdjustmentsAndTotals();
  testDailyAndProducts();
  testAllocationRounding();
  testLossModelAndLossReport();
  testInventory();
  testPurchase();
  console.log("v2 reporting domain tests passed");
}

run();
