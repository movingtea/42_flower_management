/**
 * Pure V2 trial-operation readiness checklist.
 *
 * The service gathers V2 counts; this module turns them into stable, testable
 * section/item statuses. No check performs a repair and no status implies that
 * a business process was executed.
 */

export type SetupCheckStatus = "PASS" | "WARNING" | "CRITICAL" | "NOT_STARTED";
export type SetupCheckSeverity = "success" | "info" | "warning" | "critical";

export type SetupCheckItem = {
  key: string;
  title: string;
  status: SetupCheckStatus;
  severity: SetupCheckSeverity;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  metrics?: Record<string, number | string | boolean>;
};

export type SetupCheckSection = {
  key: string;
  title: string;
  description: string;
  status: SetupCheckStatus;
  items: SetupCheckItem[];
};

export type SetupCheckSummary = {
  totalItems: number;
  passedCount: number;
  warningCount: number;
  criticalCount: number;
  completionRate: number;
  overallStatus: SetupCheckStatus;
};

export type SetupCheckResult = {
  summary: SetupCheckSummary;
  sections: SetupCheckSection[];
  nextActions: Array<{ title: string; actionHref: string; severity: SetupCheckSeverity }>;
};

export type SetupCheckStats = {
  tenantCount: number;
  storeCount: number;
  warehouseLocationCount: number;
  activeMaterialCount: number;
  flowerMaterialCount: number;
  flowerMaterialWithCostCount: number;
  activeMaterialCategoryCount: number;
  activeSupplierCount: number;
  activePackagingKitCount: number;
  packagingKitWithoutLinesCount: number;
  activeProductCount: number;
  activeSkuCount: number;
  activeSkuWithoutRecipeCount: number;
  publishedRecipeVersionCount: number;
  publishedRecipeVersionWithoutLinesCount: number;
  purchaseOrderCount: number;
  openPurchaseOrderCount: number;
  receivedPurchaseOrderCount: number;
  batchWithStockCount: number;
  expiringBatchCount: number;
  lowStockMaterialCount: number;
  orderCount: number;
  confirmedOrderCount: number;
  deliveredOrderCount: number;
  deliveredWithoutSnapshotCount: number;
  auditEventCount7d: number;
  criticalDataQualityCount: number;
};

function worstStatus(statuses: readonly SetupCheckStatus[]): SetupCheckStatus {
  if (statuses.includes("CRITICAL")) return "CRITICAL";
  if (statuses.includes("NOT_STARTED")) return "NOT_STARTED";
  if (statuses.includes("WARNING")) return "WARNING";
  return "PASS";
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function item(partial: SetupCheckItem): SetupCheckItem {
  return partial;
}

export function buildV2SetupChecklist(stats: SetupCheckStats): SetupCheckResult {
  const sections: SetupCheckSection[] = [];

  const tenancyItems: SetupCheckItem[] = [
    item({
      key: "tenant_store",
      title: "默认租户与门店",
      status: stats.tenantCount > 0 && stats.storeCount > 0 ? "PASS" : "CRITICAL",
      severity: stats.tenantCount > 0 && stats.storeCount > 0 ? "success" : "critical",
      message:
        stats.tenantCount > 0 && stats.storeCount > 0
          ? `已配置 ${stats.tenantCount} 个租户、${stats.storeCount} 个门店。`
          : "缺少租户或门店，所有 V2 业务页面都无法使用。",
      actionHref: "/v2/system-health",
      metrics: { tenants: stats.tenantCount, stores: stats.storeCount },
    }),
    item({
      key: "warehouse_location",
      title: "仓库库位",
      status: stats.warehouseLocationCount > 0 ? "PASS" : "CRITICAL",
      severity: stats.warehouseLocationCount > 0 ? "success" : "critical",
      message:
        stats.warehouseLocationCount > 0
          ? `当前门店有 ${stats.warehouseLocationCount} 个仓库库位。`
          : "当前门店没有仓库库位，无法验收入库或登记损耗。",
      actionHref: "/v2/operations",
      metrics: { locations: stats.warehouseLocationCount },
    }),
  ];
  sections.push({
    key: "tenancy",
    title: "租户与门店",
    description: "V2 数据必须落在当前租户和门店内，库位是库存作业的前提。",
    status: worstStatus(tenancyItems.map((entry) => entry.status)),
    items: tenancyItems,
  });

  const materialItems: SetupCheckItem[] = [
    item({
      key: "materials",
      title: "物料主数据",
      status:
        stats.activeMaterialCount >= 10 ? "PASS" : stats.activeMaterialCount > 0 ? "WARNING" : "NOT_STARTED",
      severity: stats.activeMaterialCount >= 10 ? "success" : "warning",
      message:
        stats.activeMaterialCount >= 10
          ? `已启用 ${stats.activeMaterialCount} 个物料。`
          : stats.activeMaterialCount > 0
            ? `当前 ${stats.activeMaterialCount} 个启用物料，建议至少 10 个再试运营。`
            : "尚未创建启用物料。",
      actionLabel: "维护物料",
      actionHref: "/v2/materials",
      metrics: { active: stats.activeMaterialCount },
    }),
    item({
      key: "material_cost",
      title: "花材标准成本覆盖",
      status:
        stats.flowerMaterialCount === 0
          ? "NOT_STARTED"
          : percent(stats.flowerMaterialWithCostCount, stats.flowerMaterialCount) >= 80
            ? "PASS"
            : "WARNING",
      severity:
        stats.flowerMaterialCount === 0
          ? "critical"
          : percent(stats.flowerMaterialWithCostCount, stats.flowerMaterialCount) >= 80
            ? "success"
            : "warning",
      message:
        stats.flowerMaterialCount === 0
          ? "尚未录入花材，无法验证配方成本。"
          : `${percent(stats.flowerMaterialWithCostCount, stats.flowerMaterialCount)}% 花材已维护标准单位成本（${stats.flowerMaterialWithCostCount}/${stats.flowerMaterialCount}）。`,
      actionLabel: "维护成本",
      actionHref: "/v2/materials",
      metrics: { covered: stats.flowerMaterialWithCostCount, total: stats.flowerMaterialCount },
    }),
    item({
      key: "material_categories",
      title: "原材料分类",
      status: stats.activeMaterialCategoryCount > 0 ? "PASS" : "WARNING",
      severity: stats.activeMaterialCategoryCount > 0 ? "success" : "warning",
      message:
        stats.activeMaterialCategoryCount > 0
          ? `已启用 ${stats.activeMaterialCategoryCount} 个原材料分类。`
          : "尚未配置原材料分类，物料检索和报表分组会较弱。",
      actionLabel: "维护分类",
      actionHref: "/v2/material-categories",
      metrics: { active: stats.activeMaterialCategoryCount },
    }),
    item({
      key: "suppliers",
      title: "活跃供应商",
      status:
        stats.activeSupplierCount >= 2 ? "PASS" : stats.activeSupplierCount > 0 ? "WARNING" : "CRITICAL",
      severity:
        stats.activeSupplierCount >= 2 ? "success" : stats.activeSupplierCount > 0 ? "warning" : "critical",
      message:
        stats.activeSupplierCount >= 2
          ? `已有 ${stats.activeSupplierCount} 个活跃供应商。`
          : stats.activeSupplierCount > 0
            ? `仅有 ${stats.activeSupplierCount} 个活跃供应商，建议至少 2 个。`
            : "没有活跃供应商，无法创建采购单。",
      actionLabel: "维护供应商",
      actionHref: "/v2/suppliers",
      metrics: { active: stats.activeSupplierCount },
    }),
    item({
      key: "packaging_kits",
      title: "包装方案",
      status:
        stats.activePackagingKitCount === 0
          ? "WARNING"
          : stats.packagingKitWithoutLinesCount > 0
            ? "WARNING"
            : "PASS",
      severity:
        stats.activePackagingKitCount === 0 || stats.packagingKitWithoutLinesCount > 0
          ? "warning"
          : "success",
      message:
        stats.activePackagingKitCount === 0
          ? "暂无启用包装方案；若包装已直接进入配方，可忽略此项。"
          : stats.packagingKitWithoutLinesCount > 0
            ? `${stats.activePackagingKitCount} 个包装方案中有 ${stats.packagingKitWithoutLinesCount} 个没有明细。`
            : `${stats.activePackagingKitCount} 个包装方案均已有明细。`,
      actionLabel: "维护包装方案",
      actionHref: "/v2/packaging-kits",
      metrics: {
        active: stats.activePackagingKitCount,
        withoutLines: stats.packagingKitWithoutLinesCount,
      },
    }),
  ];
  sections.push({
    key: "master_data",
    title: "WMS 主数据",
    description: "物料、分类、供应商和包装方案是采购与配方的基础。",
    status: worstStatus(materialItems.map((entry) => entry.status)),
    items: materialItems,
  });

  const recipeItems: SetupCheckItem[] = [
    item({
      key: "active_products",
      title: "在售商品与 SKU",
      status:
        stats.activeProductCount > 0 && stats.activeSkuCount > 0
          ? "PASS"
          : stats.activeProductCount > 0
            ? "WARNING"
            : "NOT_STARTED",
      severity:
        stats.activeProductCount > 0 && stats.activeSkuCount > 0 ? "success" : "warning",
      message:
        stats.activeProductCount > 0 && stats.activeSkuCount > 0
          ? `有 ${stats.activeProductCount} 个在售商品、${stats.activeSkuCount} 个启用 SKU。`
          : "还没有可下单的在售商品和 SKU。",
      actionLabel: "维护商品",
      actionHref: "/v2/catalog",
      metrics: { products: stats.activeProductCount, skus: stats.activeSkuCount },
    }),
    item({
      key: "sku_recipe",
      title: "SKU 已发布配方",
      status:
        stats.activeSkuCount === 0
          ? "NOT_STARTED"
          : stats.activeSkuWithoutRecipeCount === 0
            ? "PASS"
            : "CRITICAL",
      severity:
        stats.activeSkuCount === 0
          ? "warning"
          : stats.activeSkuWithoutRecipeCount === 0
            ? "success"
            : "critical",
      message:
        stats.activeSkuCount === 0
          ? "没有启用 SKU，无法验证配方。"
          : stats.activeSkuWithoutRecipeCount === 0
            ? "所有启用 SKU 都有已发布配方。"
            : `${stats.activeSkuWithoutRecipeCount} 个启用 SKU 没有已发布配方，确认订单后无法生成物料需求。`,
      actionLabel: "维护配方",
      actionHref: "/v2/recipes",
      metrics: { missing: stats.activeSkuWithoutRecipeCount },
    }),
    item({
      key: "recipe_lines",
      title: "已发布配方明细",
      status:
        stats.publishedRecipeVersionCount === 0
          ? "NOT_STARTED"
          : stats.publishedRecipeVersionWithoutLinesCount === 0
            ? "PASS"
            : "CRITICAL",
      severity:
        stats.publishedRecipeVersionCount === 0
          ? "warning"
          : stats.publishedRecipeVersionWithoutLinesCount === 0
            ? "success"
            : "critical",
      message:
        stats.publishedRecipeVersionCount === 0
          ? "尚无已发布配方版本。"
          : stats.publishedRecipeVersionWithoutLinesCount === 0
            ? `${stats.publishedRecipeVersionCount} 个已发布配方版本都有明细。`
            : `${stats.publishedRecipeVersionWithoutLinesCount} 个已发布配方版本没有配方行。`,
      actionLabel: "维护配方",
      actionHref: "/v2/recipes",
      metrics: {
        published: stats.publishedRecipeVersionCount,
        withoutLines: stats.publishedRecipeVersionWithoutLinesCount,
      },
    }),
  ];
  sections.push({
    key: "catalog_recipe",
    title: "商品与配方",
    description: "订单确认依赖 SKU 的已发布配方版本和完整配方行。",
    status: worstStatus(recipeItems.map((entry) => entry.status)),
    items: recipeItems,
  });

  const supplyItems: SetupCheckItem[] = [
    item({
      key: "purchase_chain",
      title: "采购单与验收",
      status:
        stats.purchaseOrderCount > 0
          ? stats.receivedPurchaseOrderCount > 0
            ? "PASS"
            : "WARNING"
          : "NOT_STARTED",
      severity: stats.receivedPurchaseOrderCount > 0 ? "success" : "warning",
      message:
        stats.purchaseOrderCount === 0
          ? "尚无采购单，建议完成一张采购单并验收以验证链路。"
          : `共 ${stats.purchaseOrderCount} 张采购单，其中 ${stats.openPurchaseOrderCount} 张进行中、${stats.receivedPurchaseOrderCount} 张已验收完成。`,
      actionLabel: "查看采购单",
      actionHref: "/v2/purchase-orders",
      metrics: {
        total: stats.purchaseOrderCount,
        open: stats.openPurchaseOrderCount,
        received: stats.receivedPurchaseOrderCount,
      },
    }),
    item({
      key: "inventory",
      title: "批次库存与效期",
      status:
        stats.batchWithStockCount > 0
          ? stats.expiringBatchCount > 0
            ? "WARNING"
            : "PASS"
          : "NOT_STARTED",
      severity:
        stats.batchWithStockCount > 0
          ? stats.expiringBatchCount > 0
            ? "warning"
            : "success"
          : "warning",
      message:
        stats.batchWithStockCount > 0
          ? `${stats.batchWithStockCount} 个批次有实存，${stats.expiringBatchCount} 个批次 7 天内到期。`
          : "没有有实存的批次，订单确认后可能全部缺料。",
      actionLabel: "查看库存",
      actionHref: "/v2/inventory",
      metrics: { batches: stats.batchWithStockCount, expiring: stats.expiringBatchCount },
    }),
    item({
      key: "low_stock",
      title: "低库存预警",
      status: stats.lowStockMaterialCount === 0 ? "PASS" : "WARNING",
      severity: stats.lowStockMaterialCount === 0 ? "success" : "warning",
      message:
        stats.lowStockMaterialCount === 0
          ? "当前没有低库存物料。"
          : `${stats.lowStockMaterialCount} 种物料低于安全库存，开单前请确认可替代方案。`,
      actionLabel: "查看库存",
      actionHref: "/v2/inventory",
      metrics: { lowStock: stats.lowStockMaterialCount },
    }),
  ];
  sections.push({
    key: "supply_chain",
    title: "采购与库存链路",
    description: "验证采购、验收、批次库存和效期预警可以形成闭环。",
    status: worstStatus(supplyItems.map((entry) => entry.status)),
    items: supplyItems,
  });

  const orderItems: SetupCheckItem[] = [
    item({
      key: "orders",
      title: "订单履约",
      status:
        stats.orderCount === 0
          ? "NOT_STARTED"
          : stats.deliveredOrderCount > 0
            ? "PASS"
            : "WARNING",
      severity: stats.deliveredOrderCount > 0 ? "success" : "warning",
      message:
        stats.orderCount === 0
          ? "尚无订单，建议完成一笔后台订单验证确认、预留、制作和交付。"
          : `共 ${stats.orderCount} 笔订单，确认 ${stats.confirmedOrderCount} 笔、已交付 ${stats.deliveredOrderCount} 笔。`,
      actionLabel: "查看订单",
      actionHref: "/v2/orders",
      metrics: {
        total: stats.orderCount,
        confirmed: stats.confirmedOrderCount,
        delivered: stats.deliveredOrderCount,
      },
    }),
    item({
      key: "cost_snapshot",
      title: "成本快照",
      status:
        stats.deliveredOrderCount === 0
          ? "WARNING"
          : stats.deliveredWithoutSnapshotCount === 0
            ? "PASS"
            : "CRITICAL",
      severity:
        stats.deliveredOrderCount === 0
          ? "warning"
          : stats.deliveredWithoutSnapshotCount === 0
            ? "success"
            : "critical",
      message:
        stats.deliveredOrderCount === 0
          ? "尚无已交付订单，无法验证成本快照与毛利报表。"
          : stats.deliveredWithoutSnapshotCount === 0
            ? "所有已交付订单都有成本快照。"
            : `${stats.deliveredWithoutSnapshotCount} 笔已交付订单缺少成本快照。`,
      actionLabel: "查看报表",
      actionHref: "/v2/reports?tab=cost",
      metrics: {
        delivered: stats.deliveredOrderCount,
        missing: stats.deliveredWithoutSnapshotCount,
      },
    }),
  ];
  sections.push({
    key: "orders_cost",
    title: "订单与成本",
    description: "交付后必须生成成本快照，经营报表才能追溯到明细。",
    status: worstStatus(orderItems.map((entry) => entry.status)),
    items: orderItems,
  });

  const readinessItems: SetupCheckItem[] = [
    item({
      key: "audit_trail",
      title: "关键操作审计",
      status: stats.auditEventCount7d > 0 ? "PASS" : "WARNING",
      severity: stats.auditEventCount7d > 0 ? "success" : "warning",
      message:
        stats.auditEventCount7d > 0
          ? `最近 7 天有 ${stats.auditEventCount7d} 条审计事件。`
          : "最近 7 天没有审计事件；完成一笔采购或订单后再检查。",
      actionLabel: "查看操作日志",
      actionHref: "/v2/audit",
      metrics: { events: stats.auditEventCount7d },
    }),
    item({
      key: "data_quality",
      title: "数据质量严重问题",
      status: stats.criticalDataQualityCount === 0 ? "PASS" : "CRITICAL",
      severity: stats.criticalDataQualityCount === 0 ? "success" : "critical",
      message:
        stats.criticalDataQualityCount === 0
          ? "当前没有严重数据质量问题。"
          : `当前有 ${stats.criticalDataQualityCount} 个严重数据质量问题，上线前必须人工处理。`,
      actionLabel: "打开数据质量",
      actionHref: "/v2/data-quality",
      metrics: { critical: stats.criticalDataQualityCount },
    }),
    item({
      key: "system_health",
      title: "数据库与迁移状态",
      status: "WARNING",
      severity: "info",
      message: "请打开系统健康页面确认 V2 数据库、迁移、环境变量和磁盘/存储状态。",
      actionLabel: "打开系统健康",
      actionHref: "/v2/system-health",
    }),
  ];
  sections.push({
    key: "launch_readiness",
    title: "上线准备状态",
    description: "审计、数据质量和系统健康是试运营关闭前的最后检查。",
    status: worstStatus(readinessItems.map((entry) => entry.status)),
    items: readinessItems,
  });

  const allItems = sections.flatMap((section) => section.items);
  const passedCount = allItems.filter((entry) => entry.status === "PASS").length;
  const warningCount = allItems.filter((entry) => entry.status === "WARNING").length;
  const criticalCount = allItems.filter(
    (entry) => entry.status === "CRITICAL" || entry.status === "NOT_STARTED",
  ).length;
  const overallStatus = worstStatus(allItems.map((entry) => entry.status));
  const nextActions = allItems
    .filter((entry) => entry.status !== "PASS" && entry.actionHref)
    .sort((left, right) => {
      const rank = (status: SetupCheckStatus) =>
        status === "CRITICAL" || status === "NOT_STARTED" ? 0 : status === "WARNING" ? 1 : 2;
      return rank(left.status) - rank(right.status);
    })
    .slice(0, 5)
    .map((entry) => ({
      title: entry.title,
      actionHref: entry.actionHref!,
      severity: entry.severity,
    }));

  return {
    summary: {
      totalItems: allItems.length,
      passedCount,
      warningCount,
      criticalCount,
      completionRate: allItems.length === 0 ? 0 : Math.round((passedCount / allItems.length) * 100),
      overallStatus,
    },
    sections,
    nextActions,
  };
}
