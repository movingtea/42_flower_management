import type { PrismaClient } from "../../generated/prisma-v2/client";
import {
  buildDailySalesRows,
  buildInventoryReport,
  buildLossModelImpact,
  buildLossReport,
  buildLowMarginRows,
  buildOrderSnapshotRow,
  buildProductMarginRows,
  buildPurchaseReport,
  selectLatestSnapshotRows,
  summarizeSnapshots,
  type CostStructure,
  type DailySalesRow,
  type InventoryMaterialInput,
  type InventoryReport,
  type LossModelImpact,
  type LossReport,
  type LowMarginOrderRow,
  type OrderSnapshotRow,
  type ProductMarginRow,
  type PurchaseReport,
  type ReportRange,
  type SnapshotSummary,
} from "../domain/reporting";

export type V2StoreScope = { tenantId: string; storeId: string };

export type OverviewReport = {
  summary: SnapshotSummary & {
    completedOrderCount: number;
    cancelledOrderCount: number;
    refundedOrderCount: number;
    missingSnapshotOrderCount: number;
  };
  costStructure: CostStructure;
  dailySales: DailySalesRow[];
  recentSnapshots: OrderSnapshotRow[];
};

export type SalesTrendReport = {
  summary: SnapshotSummary;
  dailySales: DailySalesRow[];
};

export type ProductMarginReport = {
  summary: SnapshotSummary;
  products: ProductMarginRow[];
  lowMarginOrders: LowMarginOrderRow[];
  lowMarginThreshold: number;
  allocationMethod: "ORDER_AMOUNT_RATIO";
};

export type CostSnapshotReport = {
  summary: SnapshotSummary;
  snapshots: OrderSnapshotRow[];
};

export type InventoryReportData = InventoryReport;

export type LossReportData = {
  loss: LossReport;
  lossModelImpact: LossModelImpact;
  revenue: number;
  /**
   * A very large date range can hit the per-report row caps. When that happens
   * the totals only cover the loaded rows and the page must say so instead of
   * presenting a silently incomplete summary.
   */
  truncation: {
    lossRecords: boolean;
    materialUsages: boolean;
    lossRecordLimit: number;
    materialUsageLimit: number;
  };
};

export const LOSS_RECORD_LIMIT = 1_000;
export const MATERIAL_USAGE_LIMIT = 10_000;

export type PurchaseReportData = PurchaseReport;

/**
 * Loads one row per order cost snapshot. Callers that only need totals pass
 * `withItems: false` so the item projection is not fetched.
 */
export async function loadOrderSnapshotRows(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
  options: { withItems?: boolean } = {},
): Promise<OrderSnapshotRow[]> {
  const where = {
    closedAt: { gte: range.startUtc, lt: range.endUtcExclusive },
    order: { tenantId: scope.tenantId, storeId: scope.storeId },
  };

  if (!options.withItems) {
    const rows = await db.orderCostSnapshot.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            number: true,
            commercialState: true,
          },
        },
        adjustments: { select: { kind: true, amountDelta: true } },
      },
      orderBy: [{ orderId: "asc" }, { revisionNo: "desc" }],
    });
    return selectLatestSnapshotRows(rows.map((snapshot) => buildOrderSnapshotRow({
      orderId: snapshot.orderId,
      orderNumber: snapshot.order.number,
      revisionNo: snapshot.revisionNo,
      closedAt: snapshot.closedAt,
      estimated: snapshot.estimated,
      commercialState: snapshot.order.commercialState,
      revenue: snapshot.revenue.toString(),
      materialCost: snapshot.materialCost.toString(),
      packagingCost: snapshot.packagingCost.toString(),
      consumableCost: snapshot.consumableCost.toString(),
      laborCost: snapshot.laborCost.toString(),
      deliveryCost: snapshot.deliveryCost.toString(),
      platformCost: snapshot.platformCost.toString(),
      attributedLossCost: snapshot.attributedLossCost.toString(),
      // Adjustments belong to one snapshot revision; only the selected revision's
      // signed rows may change its totals.
      adjustments: snapshot.adjustments.map((adjustment) => ({
        kind: adjustment.kind,
        amountDelta: adjustment.amountDelta.toString(),
      })),
    })));
  }

  const rows = await db.orderCostSnapshot.findMany({
    where,
    include: {
      order: {
        select: {
          id: true,
          number: true,
          commercialState: true,
          items: {
            select: {
              skuId: true,
              nameSnapshot: true,
              quantity: true,
              unitPrice: true,
              sku: {
                select: {
                  name: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
        },
      },
      adjustments: { select: { kind: true, amountDelta: true } },
    },
    orderBy: [{ orderId: "asc" }, { revisionNo: "desc" }],
  });

  return selectLatestSnapshotRows(rows.map((snapshot) => buildOrderSnapshotRow(
    {
      orderId: snapshot.orderId,
      orderNumber: snapshot.order.number,
      revisionNo: snapshot.revisionNo,
      closedAt: snapshot.closedAt,
      estimated: snapshot.estimated,
      commercialState: snapshot.order.commercialState,
      revenue: snapshot.revenue.toString(),
      materialCost: snapshot.materialCost.toString(),
      packagingCost: snapshot.packagingCost.toString(),
      consumableCost: snapshot.consumableCost.toString(),
      laborCost: snapshot.laborCost.toString(),
      deliveryCost: snapshot.deliveryCost.toString(),
      platformCost: snapshot.platformCost.toString(),
      attributedLossCost: snapshot.attributedLossCost.toString(),
      adjustments: snapshot.adjustments.map((adjustment) => ({
        kind: adjustment.kind,
        amountDelta: adjustment.amountDelta.toString(),
      })),
    },
    snapshot.order.items.map((item) => ({
      skuId: item.skuId,
      productName: item.sku?.product.name ?? item.nameSnapshot,
      skuName: item.sku?.name ?? item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
    })),
  )));
}

export async function loadOverviewReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
): Promise<OverviewReport> {
  const rows = await loadOrderSnapshotRows(db, scope, range);
  const { summary, costStructure } = summarizeSnapshots(rows);
  const [cancelledOrderCount, refundedOrderCount, missingSnapshotOrderCount] = await Promise.all([
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        commercialState: "CANCELLED",
        createdAt: { gte: range.startUtc, lt: range.endUtcExclusive },
      },
    }),
    db.refundTransaction.count({
      where: {
        state: "SUCCEEDED",
        createdAt: { gte: range.startUtc, lt: range.endUtcExclusive },
        order: { tenantId: scope.tenantId, storeId: scope.storeId },
      },
    }),
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        fulfillmentState: "DELIVERED",
        costSnapshots: { none: {} },
        // Only delivered orders handed over inside the selected range are a
        // data gap for this range's totals.
        fulfillment: {
          is: {
            handedOverAt: { gte: range.startUtc, lt: range.endUtcExclusive },
          },
        },
      },
    }),
  ]);
  return {
    summary: {
      ...summary,
      completedOrderCount: rows.length,
      cancelledOrderCount,
      refundedOrderCount,
      missingSnapshotOrderCount,
    },
    costStructure,
    dailySales: buildDailySalesRows(rows, range),
    recentSnapshots: [...rows]
      .sort((left, right) => right.closedAt.getTime() - left.closedAt.getTime())
      .slice(0, 10),
  };
}

export async function loadSalesTrendReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
): Promise<SalesTrendReport> {
  const rows = await loadOrderSnapshotRows(db, scope, range);
  return {
    summary: summarizeSnapshots(rows).summary,
    dailySales: buildDailySalesRows(rows, range),
  };
}

export async function loadProductMarginReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
  lowMarginThreshold: number,
): Promise<ProductMarginReport> {
  const rows = await loadOrderSnapshotRows(db, scope, range, { withItems: true });
  return {
    summary: summarizeSnapshots(rows).summary,
    // Keep every row: the page sums the rows for its cards and only slices the
    // table for display, so a display cap can never change a reported total.
    products: buildProductMarginRows(rows),
    lowMarginOrders: buildLowMarginRows(rows, lowMarginThreshold),
    lowMarginThreshold,
    allocationMethod: "ORDER_AMOUNT_RATIO",
  };
}

export async function loadCostSnapshotReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
): Promise<CostSnapshotReport> {
  const rows = await loadOrderSnapshotRows(db, scope, range);
  return {
    summary: summarizeSnapshots(rows).summary,
    snapshots: rows.sort((left, right) => right.closedAt.getTime() - left.closedAt.getTime()),
  };
}

export async function loadInventoryReport(
  db: PrismaClient,
  scope: V2StoreScope,
  now: Date,
): Promise<InventoryReportData> {
  const materials = await db.material.findMany({
    where: { tenantId: scope.tenantId, active: true },
    include: {
      batches: {
        where: { storeId: scope.storeId },
        include: {
          balances: { select: { onHandQty: true, frozenQty: true } },
          reservations: { where: { state: "ACTIVE" }, select: { quantity: true } },
        },
        orderBy: { receivedAt: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });
  const input: InventoryMaterialInput[] = materials.map((material) => ({
    id: material.id,
    code: material.code,
    name: material.name,
    baseUnit: material.baseUnit,
    safetyStockThreshold: Number(material.safetyStockThreshold),
    standardUnitCost: Number(material.standardUnitCost ?? 0),
    batches: material.batches.map((batch) => ({
      id: batch.id,
      batchNo: batch.batchNo,
      usableUntil: batch.usableUntil,
      unitCost: Number(batch.unitCost),
      onHandQty: batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
      frozenQty: batch.balances.reduce((sum, balance) => sum + Number(balance.frozenQty), 0),
      reservedQty: batch.reservations.reduce((sum, reservation) => sum + Number(reservation.quantity), 0),
    })),
  }));
  return buildInventoryReport(input, now);
}

export async function loadLossReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
): Promise<LossReportData> {
  const [lossRecordsPage, usageRowsPage, snapshotRows] = await Promise.all([
    db.lossRecord.findMany({
      where: {
        storeId: scope.storeId,
        store: { tenantId: scope.tenantId },
        occurredAt: { gte: range.startUtc, lt: range.endUtcExclusive },
      },
      include: {
        material: true,
        batch: { select: { batchNo: true, unitCost: true } },
        order: { select: { id: true, number: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: LOSS_RECORD_LIMIT + 1,
    }),
    db.materialUsage.findMany({
      where: {
        task: {
          completedAt: { gte: range.startUtc, lt: range.endUtcExclusive },
          orderItem: { order: { tenantId: scope.tenantId, storeId: scope.storeId } },
        },
      },
      include: {
        batch: { include: { material: true } },
        task: { select: { orderItem: { select: { orderId: true } } } },
      },
      // Keep the most recent usages when a wide range exceeds the row cap.
      orderBy: { task: { completedAt: "desc" } },
      take: MATERIAL_USAGE_LIMIT + 1,
    }),
    loadOrderSnapshotRows(db, scope, range),
  ]);

  const lossRecords = lossRecordsPage.slice(0, LOSS_RECORD_LIMIT);
  const usages = usageRowsPage.slice(0, MATERIAL_USAGE_LIMIT);

  const loss = buildLossReport(
    lossRecords.map((record) => {
      const unitCost = Number(record.batch?.unitCost ?? record.material?.standardUnitCost ?? 0);
      return {
        id: record.id,
        occurredAt: record.occurredAt,
        reason: record.reason,
        quantity: Number(record.quantity),
        materialName: record.material?.name ?? "未关联物料",
        baseUnit: record.material?.baseUnit ?? "",
        unitCost,
        batchNo: record.batch?.batchNo ?? null,
        orderId: record.order?.id ?? null,
        orderNumber: record.order?.number ?? null,
      };
    }),
    usages.map((usage) => ({
      materialId: usage.batch.materialId,
      materialName: usage.batch.material.name,
      baseUnit: usage.batch.material.baseUnit,
      usedQty: Number(usage.usedQty),
      lostQty: Number(usage.lostQty),
      returnedQty: Number(usage.returnedQty),
      unitCost: Number(usage.batch.unitCost),
      orderId: usage.task.orderItem.orderId,
    })),
  );

  const revenue = summarizeSnapshots(snapshotRows).summary.revenue;
  const impact = buildLossModelImpact(
    usages.map((usage) => ({
      materialId: usage.batch.materialId,
      materialName: usage.batch.material.name,
      usedQty: Number(usage.usedQty),
      unitCost: Number(usage.batch.unitCost),
      usableRate: usage.batch.material.standardUsableRate == null
        ? usage.batch.material.optimisticUsableRate == null
          ? null
          : Number(usage.batch.material.optimisticUsableRate)
        : Number(usage.batch.material.standardUsableRate),
    })),
    revenue,
  );

  return {
    loss,
    lossModelImpact: impact,
    revenue,
    truncation: {
      lossRecords: lossRecordsPage.length > LOSS_RECORD_LIMIT,
      materialUsages: usageRowsPage.length > MATERIAL_USAGE_LIMIT,
      lossRecordLimit: LOSS_RECORD_LIMIT,
      materialUsageLimit: MATERIAL_USAGE_LIMIT,
    },
  };
}

export async function loadPurchaseReport(
  db: PrismaClient,
  scope: V2StoreScope,
  range: ReportRange,
): Promise<PurchaseReportData> {
  const purchaseOrders = await db.purchaseOrder.findMany({
    where: {
      tenantId: scope.tenantId,
      storeId: scope.storeId,
      orderedAt: { gte: range.startUtc, lt: range.endUtcExclusive },
      state: { in: ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: {
        include: {
          material: { select: { code: true, name: true, baseUnit: true } },
          receiptLines: {
            include: {
              receipt: { select: { receivedAt: true } },
              batch: {
                include: {
                  balances: { select: { onHandQty: true } },
                  usages: { select: { usedQty: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ orderedAt: "desc" }, { number: "desc" }],
  });

  const lines = purchaseOrders.flatMap((purchaseOrder) =>
    purchaseOrder.lines.map((line) => ({
      purchaseOrderId: purchaseOrder.id,
      purchaseNumber: purchaseOrder.number,
      supplierId: purchaseOrder.supplierId,
      supplierName: purchaseOrder.supplier.name,
      orderedAt: purchaseOrder.orderedAt ?? purchaseOrder.createdAt,
      state: purchaseOrder.state,
      freightCost: Number(purchaseOrder.freightCost),
      packagingCost: Number(purchaseOrder.packagingCost),
      otherCost: Number(purchaseOrder.otherCost),
      materialId: line.materialId,
      materialCode: line.material.code,
      materialName: line.material.name,
      baseUnit: line.material.baseUnit,
      orderedQty: Number(line.orderedQty),
      expectedBaseQty: line.expectedBaseQty == null ? null : Number(line.expectedBaseQty),
      unitPrice: Number(line.unitPrice),
      receipts: line.receiptLines.map((receiptLine) => ({
        disposition: receiptLine.disposition,
        quantity: Number(receiptLine.quantity),
        receivedAt: receiptLine.receipt.receivedAt,
        finalUnitCost: receiptLine.finalUnitCost == null ? null : Number(receiptLine.finalUnitCost),
        batch: receiptLine.batch
          ? {
              id: receiptLine.batch.id,
              batchNo: receiptLine.batch.batchNo,
              unitCost: Number(receiptLine.batch.unitCost),
              onHandQty: receiptLine.batch.balances.reduce((sum, balance) => sum + Number(balance.onHandQty), 0),
              usedQty: receiptLine.batch.usages.reduce((sum, usage) => sum + Number(usage.usedQty), 0),
            }
          : null,
      })),
    })),
  );

  return buildPurchaseReport(lines);
}
