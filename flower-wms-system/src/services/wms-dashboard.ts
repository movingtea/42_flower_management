import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { getAppDayRangeUtc, getTodayAppDateString } from "@/lib/datetime";
import { listMaterialsForLowStockCheck } from "@/lib/wms-inventory";
import { prisma } from "@/lib/prisma";
import type { DashboardMetrics } from "@/types";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export type DashboardRecentOrder = {
  id: string;
  orderNo: string;
  customer: string;
  amount: string;
  status: OrderStatus;
};

export type DashboardLowStockRow = {
  id: string;
  name: string;
  materialCode: string;
  quantity: number;
  minStock: number;
  unit: string;
};

export type WmsDashboardData = {
  metrics: DashboardMetrics;
  recentOrders: DashboardRecentOrder[];
  lowStockItems: DashboardLowStockRow[];
};

/**
 * 加载 WMS 仪表盘指标与列表（Server Component 直连 Prisma，无需 Mock）。
 */
export async function loadWmsDashboardData(): Promise<WmsDashboardData> {
  const now = Date.now();
  const expiringBefore = new Date(now + THREE_DAYS_MS);
  const { startUtc: todayStart, endUtcExclusive: todayEnd } = getAppDayRangeUtc(
    getTodayAppDateString()
  );

  const [
    expiringBatchCount,
    materials,
    todayWastageAgg,
    todaySaleOutAgg,
    todayOrderCount,
    todayRevenueAgg,
    recentOrders,
  ] = await Promise.all([
    prisma.batch.count({
      where: {
        remainingQty: { gt: 0 },
        expiresAt: { gte: new Date(now), lte: expiringBefore },
      },
    }),
    listMaterialsForLowStockCheck(),
    prisma.stockLog.aggregate({
      where: {
        type: StockLogType.WASTAGE_OUT,
        createdAt: { gte: todayStart, lt: todayEnd },
      },
      _sum: { quantity: true },
    }),
    prisma.stockLog.aggregate({
      where: {
        type: StockLogType.SALE_OUT,
        createdAt: { gte: todayStart, lt: todayEnd },
      },
      _sum: { quantity: true },
    }),
    prisma.order.count({
      where: { createdAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: todayStart, lt: todayEnd },
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.PRODUCTION,
            OrderStatus.DELIVERING,
            OrderStatus.COMPLETED,
          ],
        },
      },
      _sum: { totalAmount: true },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        orderNo: true,
        status: true,
        totalAmount: true,
        receiverName: true,
      },
    }),
  ]);

  const lowStockItems: DashboardLowStockRow[] = [];
  for (const m of materials) {
    const quantity = m.batches.reduce((sum, b) => sum + b.remainingQty, 0);
    const minStock = m.safetyStockThreshold;
    const isLow = minStock > 0 ? quantity < minStock : quantity === 0;
    if (isLow) {
      lowStockItems.push({
        id: m.id,
        name: m.name,
        materialCode: m.materialCode,
        quantity,
        minStock,
        unit: m.unit,
      });
    }
  }

  lowStockItems.sort((a, b) => a.quantity - b.quantity);

  const todayWastageQty = todayWastageAgg._sum.quantity ?? 0;
  const todaySaleOutQty = todaySaleOutAgg._sum.quantity ?? 0;
  const outboundToday = todayWastageQty + todaySaleOutQty;
  const todayWastageRate =
    outboundToday > 0
      ? `${((todayWastageQty / outboundToday) * 100).toFixed(1)}%`
      : "0%";

  const todayRevenue = Number(todayRevenueAgg._sum.totalAmount ?? 0);

  return {
    metrics: {
      expiringBatchCount,
      lowStockProductCount: lowStockItems.length,
      todayWastageQty,
      todayWastageRate,
      todayOrders: todayOrderCount,
      todayRevenue: Math.round(todayRevenue),
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      customer: o.receiverName || "微信顾客",
      amount: Number(o.totalAmount).toFixed(2),
      status: o.status,
    })),
    lowStockItems: lowStockItems.slice(0, 10),
  };
}
