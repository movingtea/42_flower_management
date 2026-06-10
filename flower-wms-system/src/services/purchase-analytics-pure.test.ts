/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/purchase-analytics-pure.test.ts
 */
import assert from "node:assert/strict";
import { StockLogType } from "@/generated/prisma/enums";
import {
  calculateBatchCostContribution,
  calculateBatchSalesConversion,
  calculateFlowerPurchasePriceTrends,
  calculatePurchaseAnalyticsSummary,
  calculateSupplierPurchaseRanking,
  generatePurchaseRecommendationTags,
  type BatchAnalyticsRow,
  type PurchaseLineAnalyticsRow,
  type PurchaseOrderAnalyticsRow,
  type StockLogAnalyticsRow,
} from "./purchase-analytics-pure";

function makeOrder(
  overrides: Partial<PurchaseOrderAnalyticsRow> & Pick<PurchaseOrderAnalyticsRow, "id" | "supplierId">
): PurchaseOrderAnalyticsRow {
  return {
    purchaseNo: `PO-${overrides.id}`,
    status: "RECEIVED",
    purchaseDate: new Date("2026-06-01"),
    receivedAt: new Date("2026-06-02"),
    createdAt: new Date("2026-06-01"),
    goodsAmount: "100.00",
    totalExtraFee: "10.00",
    totalAmount: "110.00",
    supplier: {
      id: overrides.supplierId,
      name: overrides.supplier?.name ?? `供应商-${overrides.supplierId}`,
      supplierType: overrides.supplier?.supplierType ?? "LOCAL",
    },
    ...overrides,
  };
}

function makeLine(
  order: PurchaseOrderAnalyticsRow,
  overrides: Partial<PurchaseLineAnalyticsRow> &
    Pick<PurchaseLineAnalyticsRow, "id" | "flowerWikiId">
): PurchaseLineAnalyticsRow {
  return {
    purchaseOrderId: order.id,
    purchaseQuantity: "1",
    stemsPerUnit: "10",
    totalStems: "10",
    unitPrice: "10.00",
    lineAmount: "100.00",
    allocatedExtraFee: "10.00",
    actualTotalCost: "110.00",
    actualUnitCost: "11.0000",
    usableRate: "0.8500",
    lossRate: "0.1500",
    lossAdjustedTotalCost: "129.41",
    lossAdjustedUnitCost: "12.9412",
    inboundBatchId: `batch-${overrides.id}`,
    flowerWiki: {
      id: overrides.flowerWikiId,
      chineseName: overrides.flowerWiki?.chineseName ?? "测试花材",
    },
    purchaseOrder: order,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<BatchAnalyticsRow> & Pick<BatchAnalyticsRow, "id">): BatchAnalyticsRow {
  return {
    batchNo: `B-${overrides.id}`,
    materialId: "mat-1",
    originalQty: 100,
    remainingQty: 20,
    unitCost: "10.0000",
    lossAdjustedUnitCost: "12.0000",
    usableRate: "0.8333",
    lossRate: "0.1667",
    supplier: "供应商A",
    inboundAt: new Date("2026-06-01"),
    createdAt: new Date("2026-06-01"),
    flowerWikiId: "fw-rose",
    flowerName: "红玫瑰",
    ...overrides,
  };
}

function testSummary() {
  const order = makeOrder({ id: "po-1", supplierId: "sup-1", totalAmount: "250.00" });
  const line = makeLine(order, {
    id: "line-1",
    flowerWikiId: "fw-rose",
    totalStems: "40",
    actualTotalCost: "200.00",
    lossAdjustedTotalCost: "240.00",
    actualUnitCost: "5.0000",
    lossAdjustedUnitCost: "6.0000",
  });

  const summary = calculatePurchaseAnalyticsSummary({
    receivedPurchaseOrders: [order],
    purchaseLines: [line],
    batches: [makeBatch({ id: "batch-line-1" })],
    dateRange: {
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-11"),
    },
  });

  assert.equal(summary.purchaseAmount.toFixed(2), "250.00");
  assert.equal(summary.purchaseOrderCount, 1);
  assert.equal(summary.totalInboundStems.toFixed(2), "40.00");
  assert.equal(summary.rawPurchaseCost.toFixed(2), "200.00");
  assert.equal(summary.lossAdjustedPurchaseCost.toFixed(2), "240.00");
  assert.equal(summary.lossModelExtraCost.toFixed(2), "40.00");
  assert.equal(summary.averageActualUnitCost?.toFixed(4), "5.0000");
  assert.equal(summary.averageLossAdjustedUnitCost?.toFixed(4), "6.0000");
}

function testSummaryZeroStemsNoDivideByZero() {
  const order = makeOrder({ id: "po-zero", supplierId: "sup-1", totalAmount: "0.00" });
  const line = makeLine(order, {
    id: "line-zero",
    flowerWikiId: "fw-rose",
    totalStems: "0",
    actualTotalCost: "0.00",
    lossAdjustedTotalCost: "0.00",
  });

  const summary = calculatePurchaseAnalyticsSummary({
    receivedPurchaseOrders: [order],
    purchaseLines: [line],
    batches: [],
    dateRange: {
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-11"),
    },
  });

  assert.equal(summary.averageActualUnitCost, null);
  assert.equal(summary.averageLossAdjustedUnitCost, null);
  assert.ok(summary.warnings.some((warning) => warning.includes("入库支数为 0")));
}

function testSupplierRanking() {
  const orderA = makeOrder({
    id: "po-a",
    supplierId: "sup-a",
    totalAmount: "300.00",
    supplier: { id: "sup-a", name: "供应商A", supplierType: "LOCAL" },
  });
  const orderB = makeOrder({
    id: "po-b",
    supplierId: "sup-b",
    totalAmount: "100.00",
    supplier: { id: "sup-b", name: "供应商B", supplierType: "KUNMING_ONLINE" },
  });

  const lines = [
    makeLine(orderA, {
      id: "line-a1",
      flowerWikiId: "fw-1",
      totalStems: "20",
      actualTotalCost: "200.00",
      lossAdjustedTotalCost: "220.00",
    }),
    makeLine(orderB, {
      id: "line-b1",
      flowerWikiId: "fw-2",
      totalStems: "10",
      actualTotalCost: "80.00",
      lossAdjustedTotalCost: "120.00",
    }),
  ];

  const ranking = calculateSupplierPurchaseRanking({
    receivedPurchaseOrders: [orderA, orderB],
    purchaseLines: lines,
    limit: 10,
  });

  assert.equal(ranking.length, 2);
  assert.equal(ranking[0].supplierId, "sup-a");
  assert.equal(ranking[0].purchaseAmount.toFixed(2), "300.00");
  assert.equal(ranking[1].supplierId, "sup-b");
  assert.equal(ranking[1].lossImpactRate, 0.5);
  assert.ok(ranking[1].tags.includes("CAUTIOUS_PURCHASE"));
}

function testSupplierTags() {
  const stableOrder1 = makeOrder({ id: "po-s1", supplierId: "sup-stable", totalAmount: "100.00" });
  const stableOrder2 = makeOrder({ id: "po-s2", supplierId: "sup-stable", totalAmount: "100.00" });
  const stableOrder3 = makeOrder({ id: "po-s3", supplierId: "sup-stable", totalAmount: "100.00" });
  const observeOrder = makeOrder({ id: "po-o1", supplierId: "sup-observe", totalAmount: "50.00" });

  const lines = [
    makeLine(stableOrder1, {
      id: "l-s1",
      flowerWikiId: "fw-1",
      actualTotalCost: "100.00",
      lossAdjustedTotalCost: "105.00",
    }),
    makeLine(stableOrder2, {
      id: "l-s2",
      flowerWikiId: "fw-1",
      actualTotalCost: "100.00",
      lossAdjustedTotalCost: "105.00",
    }),
    makeLine(stableOrder3, {
      id: "l-s3",
      flowerWikiId: "fw-1",
      actualTotalCost: "100.00",
      lossAdjustedTotalCost: "105.00",
    }),
    makeLine(observeOrder, {
      id: "l-o1",
      flowerWikiId: "fw-2",
      actualTotalCost: "50.00",
      lossAdjustedTotalCost: "50.00",
    }),
  ];

  const ranking = calculateSupplierPurchaseRanking({
    receivedPurchaseOrders: [stableOrder1, stableOrder2, stableOrder3, observeOrder],
    purchaseLines: lines,
  });

  const stable = ranking.find((row) => row.supplierId === "sup-stable");
  const observe = ranking.find((row) => row.supplierId === "sup-observe");
  assert.ok(stable?.tags.includes("STABLE_SUPPLIER"));
  assert.ok(observe?.tags.includes("OBSERVE"));
}

function testFlowerPriceTrends() {
  const order1 = makeOrder({
    id: "po-1",
    supplierId: "sup-1",
    receivedAt: new Date("2026-06-10"),
  });
  const order2 = makeOrder({
    id: "po-2",
    supplierId: "sup-2",
    receivedAt: new Date("2026-06-01"),
    supplier: { id: "sup-2", name: "昆明供应商", supplierType: "KUNMING_ONLINE" },
  });

  const lines = [
    makeLine(order1, {
      id: "line-latest",
      flowerWikiId: "fw-rose",
      actualUnitCost: "12.0000",
      lossAdjustedUnitCost: "14.0000",
      flowerWiki: { id: "fw-rose", chineseName: "红玫瑰" },
    }),
    makeLine(order2, {
      id: "line-previous",
      flowerWikiId: "fw-rose",
      actualUnitCost: "10.0000",
      lossAdjustedUnitCost: "11.0000",
      flowerWiki: { id: "fw-rose", chineseName: "红玫瑰" },
    }),
  ];

  const trends = calculateFlowerPurchasePriceTrends({ purchaseLines: lines });
  const rose = trends.find((row) => row.flowerWikiId === "fw-rose");
  assert.ok(rose);
  assert.equal(rose.latestActualUnitCost?.toFixed(4), "12.0000");
  assert.equal(rose.previousActualUnitCost?.toFixed(4), "10.0000");
  assert.equal(rose.actualUnitCostChange?.toFixed(4), "2.0000");
  assert.equal(rose.actualUnitCostChangeRate, 0.2);
  assert.ok(rose.tags.includes("PRICE_UP"));
}

function testFlowerPriceDownAndInsufficientData() {
  const order1 = makeOrder({
    id: "po-down-1",
    supplierId: "sup-1",
    receivedAt: new Date("2026-06-10"),
  });
  const order2 = makeOrder({
    id: "po-down-2",
    supplierId: "sup-1",
    receivedAt: new Date("2026-06-01"),
  });
  const singleOrder = makeOrder({
    id: "po-single",
    supplierId: "sup-2",
    receivedAt: new Date("2026-06-05"),
  });

  const downLines = [
    makeLine(order1, {
      id: "line-down-latest",
      flowerWikiId: "fw-lily",
      actualUnitCost: "8.0000",
      flowerWiki: { id: "fw-lily", chineseName: "百合" },
    }),
    makeLine(order2, {
      id: "line-down-previous",
      flowerWikiId: "fw-lily",
      actualUnitCost: "10.0000",
      flowerWiki: { id: "fw-lily", chineseName: "百合" },
    }),
  ];

  const downTrend = calculateFlowerPurchasePriceTrends({ purchaseLines: downLines }).find(
    (row) => row.flowerWikiId === "fw-lily"
  );
  assert.ok(downTrend);
  assert.equal(downTrend.actualUnitCostChangeRate, -0.2);
  assert.ok(downTrend.tags.includes("PRICE_DOWN"));

  const singleTrend = calculateFlowerPurchasePriceTrends({
    purchaseLines: [
      makeLine(singleOrder, {
        id: "line-single",
        flowerWikiId: "fw-carnation",
        actualUnitCost: "5.0000",
        flowerWiki: { id: "fw-carnation", chineseName: "康乃馨" },
      }),
    ],
  }).find((row) => row.flowerWikiId === "fw-carnation");
  assert.ok(singleTrend);
  assert.ok(singleTrend.tags.includes("INSUFFICIENT_DATA"));
}

function testBatchSalesConversion() {
  const batch = makeBatch({
    id: "batch-1",
    originalQty: 100,
    remainingQty: 50,
    inboundAt: new Date("2026-05-20"),
  });
  const logs: StockLogAnalyticsRow[] = [
    {
      id: "log-1",
      materialId: "mat-1",
      batchId: "batch-1",
      orderId: "order-1",
      orderItemId: "item-1",
      type: StockLogType.SALE_OUT,
      quantity: 30,
      delta: -30,
      createdAt: new Date("2026-06-01"),
    },
    {
      id: "log-2",
      materialId: "mat-1",
      batchId: "batch-1",
      orderId: null,
      orderItemId: null,
      type: StockLogType.WASTAGE_OUT,
      quantity: 5,
      delta: -5,
      createdAt: new Date("2026-06-02"),
    },
    {
      id: "log-3",
      materialId: "mat-1",
      batchId: "batch-1",
      orderId: "order-1",
      orderItemId: "item-1",
      type: StockLogType.IN_CANCEL,
      quantity: 2,
      delta: 2,
      createdAt: new Date("2026-06-03"),
    },
    {
      id: "log-4",
      materialId: "mat-1",
      batchId: "batch-1",
      orderId: null,
      orderItemId: null,
      type: StockLogType.ADJUSTMENT,
      quantity: 3,
      delta: -3,
      createdAt: new Date("2026-06-04"),
    },
  ];

  const rows = calculateBatchSalesConversion({
    batches: [batch],
    stockLogs: logs,
    now: new Date("2026-06-10"),
  });

  const row = rows[0];
  assert.equal(row.soldQty, 30);
  assert.equal(row.wastageQty, 5);
  assert.equal(row.cancelReturnQty, 2);
  assert.equal(row.adjustmentQty, 3);
  assert.equal(row.salesConversionRate, 0.3);
  assert.equal(row.actualWastageRate, 0.05);
  assert.equal(row.remainingRate, 0.5);
  assert.equal(row.rawCost.toFixed(2), "300.00");
  assert.equal(row.lossAdjustedCost.toFixed(2), "360.00");
  assert.ok(row.tags.includes("PRIORITIZE_USE"));
}

function testBatchSalesConversionTags() {
  const goodBatch = makeBatch({
    id: "batch-good",
    originalQty: 100,
    remainingQty: 10,
    inboundAt: new Date("2026-06-01"),
  });
  const slowBatch = makeBatch({
    id: "batch-slow",
    originalQty: 100,
    remainingQty: 80,
    inboundAt: new Date("2026-05-01"),
  });

  const logs: StockLogAnalyticsRow[] = [
    {
      id: "sale-good",
      materialId: "mat-1",
      batchId: "batch-good",
      orderId: "order-1",
      orderItemId: null,
      type: StockLogType.SALE_OUT,
      quantity: 85,
      delta: -85,
      createdAt: new Date("2026-06-05"),
    },
    {
      id: "waste-good",
      materialId: "mat-1",
      batchId: "batch-good",
      orderId: null,
      orderItemId: null,
      type: StockLogType.WASTAGE_OUT,
      quantity: 2,
      delta: -2,
      createdAt: new Date("2026-06-05"),
    },
    {
      id: "sale-slow",
      materialId: "mat-1",
      batchId: "batch-slow",
      orderId: "order-2",
      orderItemId: null,
      type: StockLogType.SALE_OUT,
      quantity: 20,
      delta: -20,
      createdAt: new Date("2026-06-05"),
    },
  ];

  const rows = calculateBatchSalesConversion({
    batches: [goodBatch, slowBatch],
    stockLogs: logs,
    now: new Date("2026-06-10"),
  });

  const good = rows.find((row) => row.batchId === "batch-good");
  const slow = rows.find((row) => row.batchId === "batch-slow");
  assert.ok(good?.tags.includes("GOOD_CONVERSION"));
  assert.ok(slow?.tags.includes("SLOW_MOVING"));
}

function testBatchCostContribution() {
  const batchWithLoss = makeBatch({
    id: "batch-cost-1",
    unitCost: "10.0000",
    lossAdjustedUnitCost: "12.0000",
  });
  const batchWithoutLoss = makeBatch({
    id: "batch-cost-2",
    unitCost: "8.0000",
    lossAdjustedUnitCost: null,
  });

  const logs: StockLogAnalyticsRow[] = [
    {
      id: "sale-1",
      materialId: "mat-1",
      batchId: "batch-cost-1",
      orderId: "order-1",
      orderItemId: "item-1",
      type: StockLogType.SALE_OUT,
      quantity: 10,
      delta: -10,
      createdAt: new Date("2026-06-01"),
    },
    {
      id: "sale-2",
      materialId: "mat-1",
      batchId: "batch-cost-1",
      orderId: "order-2",
      orderItemId: "item-2",
      type: StockLogType.SALE_OUT,
      quantity: 5,
      delta: -5,
      createdAt: new Date("2026-06-02"),
    },
    {
      id: "sale-3",
      materialId: "mat-1",
      batchId: "batch-cost-2",
      orderId: "order-1",
      orderItemId: "item-3",
      type: StockLogType.SALE_OUT,
      quantity: 4,
      delta: -4,
      createdAt: new Date("2026-06-03"),
    },
  ];

  const rows = calculateBatchCostContribution({
    batches: [batchWithLoss, batchWithoutLoss],
    stockLogs: logs,
  });

  const withLoss = rows.find((row) => row.batchId === "batch-cost-1");
  const withoutLoss = rows.find((row) => row.batchId === "batch-cost-2");

  assert.ok(withLoss);
  assert.equal(withLoss.soldQty, 15);
  assert.equal(withLoss.orderCount, 2);
  assert.equal(withLoss.rawCostContribution.toFixed(2), "150.00");
  assert.equal(withLoss.lossAdjustedCostContribution.toFixed(2), "180.00");
  assert.equal(withLoss.lossModelExtraCost.toFixed(2), "30.00");

  assert.ok(withoutLoss);
  assert.equal(withoutLoss.rawCostContribution.toFixed(2), "32.00");
  assert.equal(withoutLoss.lossAdjustedCostContribution.toFixed(2), "32.00");
  assert.ok(
    withoutLoss.warnings.some((warning) => warning.includes("未记录损耗调整后单支成本"))
  );
}

function testGeneratePurchaseRecommendationTags() {
  const supplierTags = generatePurchaseRecommendationTags({
    entity: "supplier",
    purchaseOrderCount: 1,
    lossImpactRate: 0.2,
  });
  assert.ok(supplierTags.includes("OBSERVE"));
  assert.ok(supplierTags.includes("CAUTIOUS_PURCHASE"));

  const flowerTags = generatePurchaseRecommendationTags({
    entity: "flower",
    purchaseCount: 1,
    actualUnitCostChangeRate: 0.15,
    lossImpactRate: 0.2,
  });
  assert.ok(flowerTags.includes("INSUFFICIENT_DATA"));
  assert.ok(flowerTags.includes("PRICE_UP"));
  assert.ok(flowerTags.includes("HIGH_LOSS_IMPACT"));
}

function run() {
  testSummary();
  testSummaryZeroStemsNoDivideByZero();
  testSupplierRanking();
  testSupplierTags();
  testFlowerPriceTrends();
  testFlowerPriceDownAndInsufficientData();
  testBatchSalesConversion();
  testBatchSalesConversionTags();
  testBatchCostContribution();
  testGeneratePurchaseRecommendationTags();
  console.log("purchase-analytics-pure tests passed");
}

run();
