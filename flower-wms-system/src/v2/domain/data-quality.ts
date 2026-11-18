/**
 * Pure V2 data-quality types, filtering and issue factories.
 *
 * The WMS checks are deliberately read-only: the service only reports rows and
 * links to the page where a human can fix them. No function in this module or
 * the service mutates business data.
 */

export const DATA_QUALITY_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type DataQualitySeverity = (typeof DATA_QUALITY_SEVERITIES)[number];

export const DATA_QUALITY_DOMAINS = [
  "TENANCY",
  "MASTER_DATA",
  "RECIPE",
  "INVENTORY",
  "PURCHASE",
  "ORDER",
  "COST",
] as const;
export type DataQualityDomain = (typeof DATA_QUALITY_DOMAINS)[number];

export const DATA_QUALITY_DOMAIN_LABELS: Readonly<Record<DataQualityDomain, string>> = {
  TENANCY: "租户与门店",
  MASTER_DATA: "主数据",
  RECIPE: "配方",
  INVENTORY: "库存",
  PURCHASE: "采购",
  ORDER: "订单",
  COST: "成本",
};

export const DATA_QUALITY_SEVERITY_LABELS: Readonly<Record<DataQualitySeverity, string>> = {
  CRITICAL: "严重",
  WARNING: "警告",
  SUGGESTION: "建议",
};

export type DataQualityIssue = {
  id: string;
  severity: DataQualitySeverity;
  domain: DataQualityDomain;
  entityType: string;
  entityId: string | null;
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
  metadata?: Record<string, unknown>;
};

export type DataQualitySummary = {
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
  totalCount: number;
  passedCheckCount: number;
};

export type DataQualityCheckResult = {
  key: string;
  domain: DataQualityDomain;
  title: string;
  issueCount: number;
};

export type DataQualityResult = {
  summary: DataQualitySummary;
  issues: DataQualityIssue[];
  checks: DataQualityCheckResult[];
  truncated: boolean;
  generatedAt: Date;
};

export type DataQualityFilter = {
  severity?: DataQualitySeverity | null;
  domain?: DataQualityDomain | null;
  page?: number;
  pageSize?: number;
};

export function isDataQualitySeverity(value: unknown): value is DataQualitySeverity {
  return typeof value === "string" && (DATA_QUALITY_SEVERITIES as readonly string[]).includes(value);
}

export function isDataQualityDomain(value: unknown): value is DataQualityDomain {
  return typeof value === "string" && (DATA_QUALITY_DOMAINS as readonly string[]).includes(value);
}

export function createDataQualityIssue(
  partial: Omit<DataQualityIssue, "id"> & { id?: string },
): DataQualityIssue {
  const id = partial.id
    ?? `${partial.domain}:${partial.entityType}:${partial.entityId ?? "global"}:${partial.title}`;
  return { ...partial, id };
}

export function summarizeDataQualityIssues(
  issues: readonly DataQualityIssue[],
  checks: readonly DataQualityCheckResult[] = [],
): DataQualitySummary {
  return {
    criticalCount: issues.filter((issue) => issue.severity === "CRITICAL").length,
    warningCount: issues.filter((issue) => issue.severity === "WARNING").length,
    suggestionCount: issues.filter((issue) => issue.severity === "SUGGESTION").length,
    totalCount: issues.length,
    passedCheckCount: checks.filter((check) => check.issueCount === 0).length,
  };
}

const SEVERITY_RANK: Readonly<Record<DataQualitySeverity, number>> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

export function sortDataQualityIssues(issues: readonly DataQualityIssue[]): DataQualityIssue[] {
  return [...issues].sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.domain.localeCompare(right.domain)
    || left.title.localeCompare(right.title),
  );
}

export function filterDataQualityIssues(
  issues: readonly DataQualityIssue[],
  params: DataQualityFilter = {},
): { issues: DataQualityIssue[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } } {
  let filtered = [...issues];
  if (params.severity) filtered = filtered.filter((issue) => issue.severity === params.severity);
  if (params.domain) filtered = filtered.filter((issue) => issue.domain === params.domain);
  filtered = sortDataQualityIssues(filtered);

  const requestedPage = Math.max(1, Math.trunc(params.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 20) || 20));
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 0;
  // Clamp an out-of-range ?page= value so the page never renders an empty list
  // while the pagination footer claims issues exist on another page.
  const page = totalPages > 0 ? Math.min(requestedPage, totalPages) : 1;
  const start = (page - 1) * pageSize;
  return {
    issues: filtered.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

export function issueMissingTenantStore(entityType: string, entityId: string, detail: string): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "TENANCY",
    entityType,
    entityId,
    title: "缺少租户或门店归属",
    message: detail,
    actionLabel: "检查门店设置",
    actionHref: "/v2/setup",
  });
}

export function issueCrossTenantReference(
  entityType: string,
  entityId: string,
  detail: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "TENANCY",
    entityType,
    entityId,
    title: "关键引用跨租户或跨门店",
    message: detail,
    actionLabel: "查看上线检查",
    actionHref: "/v2/setup",
  });
}

/**
 * A key record references the wrong sibling record without crossing a tenant or
 * store boundary (for example an order reservation whose batch material does not
 * match the material required by the order). Keep `issueCrossTenantReference`
 * only for real tenant/store ownership mismatches.
 */
export function issueBrokenReference(
  domain: DataQualityDomain,
  entityType: string,
  entityId: string,
  detail: string,
  actionHref = "/v2/orders",
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain,
    entityType,
    entityId,
    title: "关键引用异常",
    message: detail,
    actionLabel: "查看订单",
    actionHref,
  });
}

export function issueMissingRecipe(skuId: string, productName: string, skuName: string): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "RECIPE",
    entityType: "ProductSku",
    entityId: skuId,
    title: "在售 SKU 缺少已发布配方",
    message: `商品「${productName}」的 SKU「${skuName}」没有已发布配方，确认订单后无法展开物料需求。`,
    actionLabel: "维护配方",
    actionHref: "/v2/recipes",
  });
}

export function issuePublishedRecipeWithoutLines(
  versionId: string,
  productName: string,
  skuName: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "RECIPE",
    entityType: "RecipeVersion",
    entityId: versionId,
    title: "已发布配方没有明细",
    message: `「${productName} / ${skuName}」的已发布配方版本没有任何配方行。`,
    actionLabel: "维护配方",
    actionHref: "/v2/recipes",
  });
}

export function issueIllegalQuantity(
  domain: DataQualityDomain,
  entityType: string,
  entityId: string,
  detail: string,
  actionHref?: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain,
    entityType,
    entityId,
    title: "非法数量",
    message: detail,
    actionLabel: "查看明细",
    ...(actionHref ? { actionHref } : {}),
  });
}

export function issueInventoryAnomaly(
  entityType: string,
  entityId: string,
  title: string,
  detail: string,
  actionHref = "/v2/inventory",
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "INVENTORY",
    entityType,
    entityId,
    title,
    message: detail,
    actionLabel: "查看库存",
    actionHref,
  });
}

export function issueExpiredStock(
  batchId: string,
  batchNo: string,
  materialName: string,
  quantity: number,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "INVENTORY",
    entityType: "InventoryBatch",
    entityId: batchId,
    title: "过期批次仍有库存",
    message: `批次「${batchNo}」的花材「${materialName}」已过效期，仍有 ${quantity} 可用实存，请复核或报损。`,
    actionLabel: "查看库存",
    actionHref: "/v2/inventory",
  });
}

export function issueMissingStandardCost(
  materialId: string,
  materialName: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "MASTER_DATA",
    entityType: "Material",
    entityId: materialId,
    title: "花材缺少标准成本",
    message: `物料「${materialName}」未维护标准单位成本，毛利与损耗模型可能不准确。`,
    actionLabel: "编辑物料",
    actionHref: "/v2/materials",
  });
}

export function issueDeliveredWithoutSnapshot(
  orderId: string,
  orderNumber: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "COST",
    entityType: "Order",
    entityId: orderId,
    title: "已交付订单缺少成本快照",
    message: `订单 ${orderNumber} 已交付，但没有 OrderCostSnapshot，报表会遗漏该订单成本。`,
    actionLabel: "查看订单",
    actionHref: `/v2/orders?orderId=${encodeURIComponent(orderId)}`,
  });
}

export function issueZeroCostSnapshot(
  orderId: string,
  orderNumber: string,
  revenue: number,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "COST",
    entityType: "OrderCostSnapshot",
    entityId: orderId,
    title: "成本快照为零",
    message: `订单 ${orderNumber} 的收入为 ${revenue.toFixed(2)}，但成本快照为 0，请核对用料与配送成本。`,
    actionLabel: "查看订单",
    actionHref: `/v2/orders?orderId=${encodeURIComponent(orderId)}`,
  });
}

export function issueUnreceiveablePurchaseLine(
  lineId: string,
  purchaseNumber: string,
  materialName: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "PURCHASE",
    entityType: "PurchaseOrderLine",
    entityId: lineId,
    title: "采购行缺少可验收基础数量",
    message: `采购单 ${purchaseNumber} 的「${materialName}」缺少 expectedBaseQty，且采购单位与基础单位不同，无法继续验收。`,
    actionLabel: "查看采购单",
    actionHref: "/v2/purchase-orders",
  });
}

export function issueInactiveSupplierOnOpenPurchase(
  purchaseOrderId: string,
  purchaseNumber: string,
  supplierName: string,
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "PURCHASE",
    entityType: "PurchaseOrder",
    entityId: purchaseOrderId,
    title: "进行中采购单引用了停用供应商",
    message: `采购单 ${purchaseNumber} 的供应商「${supplierName}」已停用，后续验收或补货需要人工确认。`,
    actionLabel: "查看采购单",
    actionHref: "/v2/purchase-orders",
  });
}
