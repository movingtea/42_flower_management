import type { DashboardMetrics } from "@/types";

export const mockDashboardMetrics: DashboardMetrics = {
  expiringBatchCount: 3,
  lowStockProductCount: 5,
  todayWastageQty: 12,
  todayWastageRate: "2.3%",
  todayOrders: 23,
  todayRevenue: 4680,
};

/** @deprecated 使用 mockDashboardMetrics */
export const mockDashboardStats = mockDashboardMetrics;

export const mockRecentOrders = [
  { id: "1", orderNo: "FL20250522001", customer: "张女士", amount: 198, status: "preparing" },
  { id: "2", orderNo: "FL20250522002", customer: "李先生", amount: 368, status: "paid" },
  { id: "3", orderNo: "FL20250522003", customer: "王小姐", amount: 88, status: "pending" },
];

export const mockLowStockItems = [
  { name: "红玫瑰", quantity: 15, minStock: 50 },
  { name: "尤加利叶", quantity: 8, minStock: 30 },
  { name: "满天星", quantity: 22, minStock: 40 },
];
