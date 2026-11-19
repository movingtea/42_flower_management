import type { PrismaClient } from "../../generated/prisma-v2/client";
import {
  computeLossRate,
  isLowStock,
  resolveReportRange,
  summarizeSnapshots,
  type ReportRange,
} from "../domain/reporting";
import { loadOrderSnapshotRows, type V2StoreScope } from "./reporting";

export type DashboardTodo = {
  key: "shortage" | "purchase" | "production" | "delivery" | "pickup";
  label: string;
  count: number;
  href: string;
  description: string;
  tone: "danger" | "warning" | "info" | "success";
};

export type DashboardLowStockItem = {
  materialId: string;
  code: string;
  name: string;
  baseUnit: string;
  onHandQty: number;
  threshold: number;
};

export type DashboardRecentOrder = {
  id: string;
  number: string;
  createdAt: Date;
  deliveryAt: Date | null;
  commercialState: string;
  supplyState: string;
  productionState: string;
  fulfillmentState: string;
  itemSummary: string;
};

export type DashboardData = {
  metrics: {
    expiringBatchCount: number;
    lowStockMaterialCount: number;
    todayLossRate: number;
    todayLossQty: number;
    todayRevenue: number;
    todayOrderCount: number;
  };
  todos: DashboardTodo[];
  lowStockItems: DashboardLowStockItem[];
  recentOrders: DashboardRecentOrder[];
  todayRange: ReportRange;
  generatedAt: Date;
};

const THREE_DAYS_MS = 3 * 86_400_000;

export async function loadDashboardData(
  db: PrismaClient,
  scope: V2StoreScope,
  now: Date = new Date(),
): Promise<DashboardData> {
  const todayRange = resolveReportRange({ preset: "today", now });
  const expiringLimit = new Date(now.getTime() + THREE_DAYS_MS);

  const [
    expiringBatchCount,
    materials,
    lossAggregate,
    consumedAggregate,
    snapshotRows,
    recentOrders,
    shortageCount,
    draftPurchaseCount,
    openPurchaseCount,
    partialPurchaseCount,
    pendingProductionCount,
    pendingDeliveryCount,
    pendingPickupCount,
  ] = await Promise.all([
    db.inventoryBatch.count({
      where: {
        storeId: scope.storeId,
        usableUntil: { gte: now, lte: expiringLimit },
        balances: { some: { onHandQty: { gt: 0 } } },
      },
    }),
    db.material.findMany({
      where: { tenantId: scope.tenantId, active: true },
      select: {
        id: true,
        code: true,
        name: true,
        baseUnit: true,
        safetyStockThreshold: true,
        batches: {
          where: { storeId: scope.storeId },
          select: { balances: { select: { onHandQty: true } } },
        },
      },
      orderBy: { code: "asc" },
    }),
    db.lossRecord.aggregate({
      _sum: { quantity: true },
      where: {
        storeId: scope.storeId,
        store: { tenantId: scope.tenantId },
        occurredAt: { gte: todayRange.startUtc, lt: todayRange.endUtcExclusive },
      },
    }),
    db.materialUsage.aggregate({
      _sum: { usedQty: true },
      where: {
        task: {
          completedAt: { gte: todayRange.startUtc, lt: todayRange.endUtcExclusive },
          orderItem: { order: { tenantId: scope.tenantId, storeId: scope.storeId } },
        },
      },
    }),
    loadOrderSnapshotRows(db, scope, todayRange),
    db.order.findMany({
      where: { tenantId: scope.tenantId, storeId: scope.storeId },
      select: {
        id: true,
        number: true,
        createdAt: true,
        deliveryAt: true,
        commercialState: true,
        supplyState: true,
        productionState: true,
        fulfillmentState: true,
        items: { select: { nameSnapshot: true, quantity: true }, take: 3 },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        supplyState: "PURCHASE_REQUIRED",
        commercialState: { notIn: ["CANCELLED", "CLOSED"] },
      },
    }),
    db.purchaseOrder.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, state: "DRAFT" },
    }),
    db.purchaseOrder.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, state: "ORDERED" },
    }),
    db.purchaseOrder.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, state: "PARTIALLY_RECEIVED" },
    }),
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        commercialState: "CONFIRMED",
        productionState: "READY",
      },
    }),
    db.order.count({
      where: {
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        fulfillmentState: "WAITING_DELIVERY",
      },
    }),
    db.order.count({
      where: { tenantId: scope.tenantId, storeId: scope.storeId, fulfillmentState: "WAITING_PICKUP" },
    }),
  ]);

  const lowStock = materials.map((material) => {
    const onHandQty = material.batches.reduce(
      (sum, batch) => sum + batch.balances.reduce((inner, balance) => inner + Number(balance.onHandQty), 0),
      0,
    );
    const threshold = Number(material.safetyStockThreshold);
    return {
      materialId: material.id,
      code: material.code,
      name: material.name,
      baseUnit: material.baseUnit,
      onHandQty,
      threshold,
      lowStock: isLowStock(onHandQty, threshold),
    };
  });

  const lowStockItems = lowStock
    .filter((item) => item.lowStock)
    .sort((left, right) => {
      const leftRatio = left.threshold > 0 ? left.onHandQty / left.threshold : left.onHandQty;
      const rightRatio = right.threshold > 0 ? right.onHandQty / right.threshold : right.onHandQty;
      return leftRatio - rightRatio;
    })
    .slice(0, 6)
    .map((item) => ({
      materialId: item.materialId,
      code: item.code,
      name: item.name,
      baseUnit: item.baseUnit,
      onHandQty: item.onHandQty,
      threshold: item.threshold,
    }));

  const todayLossQty = Number(lossAggregate._sum.quantity ?? 0);
  const consumedQty = Number(consumedAggregate._sum.usedQty ?? 0);
  const summary = summarizeSnapshots(snapshotRows).summary;

  return {
    metrics: {
      expiringBatchCount,
      lowStockMaterialCount: lowStock.filter((item) => item.lowStock).length,
      todayLossRate: computeLossRate(todayLossQty, consumedQty),
      todayLossQty,
      todayRevenue: summary.revenue,
      todayOrderCount: summary.paidOrderCount,
    },
    todos: [
      {
        key: "shortage",
        label: "缺料待处理",
        count: shortageCount,
        href: "/v2/orders?supply=PURCHASE_REQUIRED",
        description: "物料未覆盖、需要采购或换料的订单；计数不含取消/关闭订单。",
        tone: "danger",
      },
      {
        key: "purchase",
        label: "待采购 / 待验收",
        count: draftPurchaseCount + openPurchaseCount + partialPurchaseCount,
        href: "/v2/purchase-orders?state=open",
        description: `草稿 ${draftPurchaseCount} 张、已下单 ${openPurchaseCount} 张、部分验收 ${partialPurchaseCount} 张。`,
        tone: "warning",
      },
      {
        key: "production",
        label: "待制作",
        count: pendingProductionCount,
        href: "/v2/orders?production=READY",
        description: "已确认、物料齐备等待制作的订单；制作中请在订单履约查看。",
        tone: "info",
      },
      {
        key: "delivery",
        label: "待配送",
        count: pendingDeliveryCount,
        href: "/v2/orders?fulfillment=WAITING_DELIVERY",
        description: "等待配送的订单；配送中请在订单履约查看。",
        tone: "info",
      },
      {
        key: "pickup",
        label: "待自提",
        count: pendingPickupCount,
        href: "/v2/orders?fulfillment=WAITING_PICKUP",
        description: "制作完成等待顾客到店自提的订单。",
        tone: "success",
      },
    ],
    lowStockItems,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      deliveryAt: order.deliveryAt,
      commercialState: order.commercialState,
      supplyState: order.supplyState,
      productionState: order.productionState,
      fulfillmentState: order.fulfillmentState,
      itemSummary: order.items
        .map((item) => `${item.nameSnapshot}×${item.quantity}`)
        .join("、") || "无商品明细",
    })),
    todayRange,
    generatedAt: now,
  };
}
