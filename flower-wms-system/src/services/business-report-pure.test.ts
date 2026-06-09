/**
 * 纯函数单测（无数据库）— 运行：npx tsx src/services/business-report-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  calculateCostStructureRatios,
  filterLowMarginRows,
  getReportDateRange,
  moneyString,
  ratioString,
  sumSalesSummaryRows,
} from "./business-report-pure";

function testDateRangeThisMonth() {
  const range = getReportDateRange({
    now: new Date(2026, 5, 9, 10, 30, 0),
  });

  assert.equal(range.label, "本月");
  assert.equal(range.startDate.toISOString(), new Date(2026, 5, 1).toISOString());
  assert.equal(range.endDate.toISOString(), new Date(2026, 5, 10).toISOString());
}

function testDateRangeToday() {
  const range = getReportDateRange({
    preset: "today",
    now: new Date(2026, 5, 9, 10, 30, 0),
  });

  assert.equal(range.label, "今日");
  assert.equal(range.startDate.toISOString(), new Date(2026, 5, 9).toISOString());
  assert.equal(range.endDate.toISOString(), new Date(2026, 5, 10).toISOString());
}

function testDateRangeCustom() {
  const range = getReportDateRange({
    startDate: "2026-06-01",
    endDate: "2026-06-09",
    now: new Date(2026, 5, 9, 10, 30, 0),
  });

  assert.equal(range.label, "2026-06-01 至 2026-06-09");
  assert.equal(range.startDate.toISOString(), new Date(2026, 5, 1).toISOString());
  assert.equal(range.endDate.toISOString(), new Date(2026, 5, 10).toISOString());
}

function testSalesSummary() {
  const summary = sumSalesSummaryRows([
    {
      id: "order-1",
      paidAmount: "100.00",
      status: "PAID",
      isEffective: true,
      isRefunded: false,
      hasSnapshot: true,
      snapshot: {
        paidAmount: "100.00",
        flowerMaterialCost: "20.00",
        packagingCost: "10.00",
        deliveryCostActual: "5.00",
        platformFee: "0.00",
        floristLaborCost: "0.00",
        otherCost: "0.00",
        totalCost: "35.00",
      },
    },
    {
      id: "order-2",
      paidAmount: "80.00",
      status: "COMPLETED",
      isEffective: true,
      isRefunded: false,
      hasSnapshot: true,
      snapshot: {
        paidAmount: "80.00",
        flowerMaterialCost: "18.00",
        packagingCost: "8.00",
        deliveryCostActual: "4.00",
        platformFee: "0.00",
        floristLaborCost: "0.00",
        otherCost: "0.00",
        totalCost: "30.00",
      },
    },
    {
      id: "order-3",
      paidAmount: "60.00",
      status: "CANCELLED",
      isEffective: false,
      isRefunded: true,
      hasSnapshot: true,
      snapshot: {
        paidAmount: "60.00",
        totalCost: "20.00",
      },
    },
    {
      id: "order-4",
      paidAmount: "40.00",
      status: "PAID",
      isEffective: true,
      isRefunded: false,
      hasSnapshot: false,
      snapshot: null,
    },
  ]);

  assert.equal(moneyString(summary.totalPaidAmount), "220.00");
  assert.equal(summary.orderCount, 3);
  assert.equal(summary.completedOrderCount, 1);
  assert.equal(summary.cancelledOrderCount, 1);
  assert.equal(summary.refundedOrderCount, 1);
  assert.equal(moneyString(summary.totalCost), "65.00");
  assert.equal(moneyString(summary.grossProfit), "155.00");
  assert.equal(ratioString(summary.grossMargin), "0.7045");
  assert.equal(summary.missingSnapshotOrderCount, 1);
  assert.deepEqual(summary.missingSnapshotOrderIds, ["order-4"]);
  assert.match(summary.warnings[0], /缺少成本快照/);
}

function testCostStructureZeroTotal() {
  const ratios = calculateCostStructureRatios({
    totalCost: "0.00",
    flowerMaterialCost: "10.00",
    packagingCost: "5.00",
    deliveryCostActual: "2.00",
    platformFee: "1.00",
    floristLaborCost: "1.00",
    otherCost: "1.00",
  });

  assert.equal(ratioString(ratios.flowerMaterialCostRatio), "0.0000");
  assert.equal(ratioString(ratios.deliveryCostRatio), "0.0000");
}

function testCostStructureRatios() {
  const ratios = calculateCostStructureRatios({
    totalCost: "100.00",
    flowerMaterialCost: "50.00",
    packagingCost: "20.00",
    deliveryCostActual: "15.00",
    platformFee: "5.00",
    floristLaborCost: "8.00",
    otherCost: "2.00",
  });

  assert.equal(ratioString(ratios.flowerMaterialCostRatio), "0.5000");
  assert.equal(ratioString(ratios.packagingCostRatio), "0.2000");
  assert.equal(ratioString(ratios.deliveryCostRatio), "0.1500");
}

function testLowMarginFilter() {
  const rows = filterLowMarginRows(
    [
      { orderId: "order-1", grossMargin: "0.40" },
      { orderId: "order-2", grossMargin: "0.20" },
      { orderId: "order-3", grossMargin: "0.30" },
    ],
    "0.35"
  );

  assert.deepEqual(
    rows.map((row) => row.orderId),
    ["order-2", "order-3"]
  );
}

function testDecimalSafety() {
  const summary = sumSalesSummaryRows([
    {
      id: "order-1",
      paidAmount: "0.00",
      status: "PAID",
      isEffective: true,
      isRefunded: false,
      hasSnapshot: true,
      snapshot: {
        paidAmount: "0.00",
        totalCost: "10.00",
      },
    },
  ]);

  assert.equal(moneyString(summary.grossProfit), "-10.00");
  assert.equal(ratioString(summary.grossMargin), "0.0000");
  assert.equal(moneyString(summary.averageOrderValue), "0.00");
}

function run() {
  testDateRangeThisMonth();
  testDateRangeToday();
  testDateRangeCustom();
  testSalesSummary();
  testCostStructureZeroTotal();
  testCostStructureRatios();
  testLowMarginFilter();
  testDecimalSafety();
  console.log("business-report-pure.test.ts — 全部通过");
}

run();
