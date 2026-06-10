export type DataQualitySeverity = "CRITICAL" | "WARNING" | "SUGGESTION";

export type DataQualityDomain =
  | "WMS"
  | "CMS"
  | "MINIPROGRAM"
  | "ORDER"
  | "CRM"
  | "REPORT"
  | "SYSTEM";

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
  passCount: number;
};

export type DataQualityResult = {
  summary: DataQualitySummary;
  issues: DataQualityIssue[];
};

export function summarizeDataQualityIssues(
  issues: DataQualityIssue[]
): DataQualitySummary {
  return {
    criticalCount: issues.filter((i) => i.severity === "CRITICAL").length,
    warningCount: issues.filter((i) => i.severity === "WARNING").length,
    suggestionCount: issues.filter((i) => i.severity === "SUGGESTION").length,
    passCount: 0,
  };
}

export function buildDataQualityResult(
  issues: DataQualityIssue[]
): DataQualityResult {
  return {
    summary: summarizeDataQualityIssues(issues),
    issues,
  };
}

export function createDataQualityIssue(
  partial: Omit<DataQualityIssue, "id"> & { id?: string }
): DataQualityIssue {
  const id =
    partial.id ??
    `${partial.domain}:${partial.entityType}:${partial.entityId ?? "global"}:${partial.title}`;
  return { ...partial, id };
}

export function filterDataQualityIssues(
  issues: DataQualityIssue[],
  params: {
    severity?: DataQualitySeverity | null;
    domain?: DataQualityDomain | null;
    page?: number;
    pageSize?: number;
  }
): { issues: DataQualityIssue[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } } {
  let filtered = issues;

  if (params.severity) {
    filtered = filtered.filter((i) => i.severity === params.severity);
  }
  if (params.domain) {
    filtered = filtered.filter((i) => i.domain === params.domain);
  }

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const total = filtered.length;
  const start = (page - 1) * pageSize;

  return {
    issues: filtered.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
  };
}

/** FlowerWiki 缺 standardUnitCost */
export function issueFlowerWikiMissingCost(
  wikiId: string,
  name: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "WMS",
    entityType: "FlowerWiki",
    entityId: wikiId,
    title: "花材缺少标准成本",
    message: `花材「${name}」未维护 standardUnitCost，产品毛利预估可能不准确。`,
    actionLabel: "编辑花材",
    actionHref: `/wms/wiki`,
  });
}

/** Recipe 无 RecipeLine */
export function issueRecipeWithoutLines(recipeId: string, name: string): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "WMS",
    entityType: "Recipe",
    entityId: recipeId,
    title: "配方缺少明细",
    message: `Recipe「${name}」没有任何 RecipeLine。`,
    actionHref: "/wms/recipes",
  });
}

/** SKU 已上架但无 recipeId */
export function issueSkuMissingRecipe(
  skuId: string,
  specName: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "CMS",
    entityType: "ProductSku",
    entityId: skuId,
    title: "SKU 未绑定配方",
    message: `款式「${specName}」未绑定 Recipe，无法准确核算成本。`,
    actionHref: "/cms/products",
  });
}

/** 商品缺主图 */
export function issueProductMissingImage(
  spuId: string,
  name: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "CMS",
    entityType: "ProductSpu",
    entityId: spuId,
    title: "商品缺少主图",
    message: `商品「${name}」缺少可用主图。`,
    actionHref: `/cms/products/${spuId}`,
  });
}

/** 推荐位关联未上架商品 */
export function issueRecommendationInactiveProduct(
  itemId: string,
  productName: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "CMS",
    entityType: "CmsRecommendationItem",
    entityId: itemId,
    title: "推荐位商品未上架",
    message: `推荐项关联商品「${productName}」未上架或已删除，小程序不会展示。`,
    actionHref: "/cms/recommendations",
  });
}

/** HomeSceneEntry 配置不完整 */
export function issueHomeSceneEntryInvalid(
  entryId: string,
  title: string,
  reason: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "CMS",
    entityType: "CmsHomeSceneEntry",
    entityId: entryId,
    title: "场景入口配置不完整",
    message: `场景入口「${title}」：${reason}`,
    actionHref: "/cms/marketing",
  });
}

/** PAID 订单缺 cost snapshot */
export function issueOrderMissingCostSnapshot(
  orderId: string,
  orderNo: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "ORDER",
    entityType: "Order",
    entityId: orderId,
    title: "已支付订单缺少成本快照",
    message: `订单 ${orderNo} 已支付但缺少 OrderCostSnapshot。`,
    actionHref: `/wms/orders`,
  });
}

/** Batch remainingQty 异常 */
export function issueBatchNegativeRemaining(
  batchId: string,
  batchNo: string | null
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "WMS",
    entityType: "Batch",
    entityId: batchId,
    title: "批次剩余量为负",
    message: `批次 ${batchNo ?? batchId} remainingQty < 0，请立即盘点。`,
    actionHref: "/wms/inventory",
  });
}

/** localhost 图片 */
export function issueLocalhostImage(
  entityType: string,
  entityId: string,
  field: string
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "CRITICAL",
    domain: "MINIPROGRAM",
    entityType,
    entityId,
    title: "图片 URL 含 localhost",
    message: `${entityType} ${entityId} 的 ${field} 包含 localhost / 127.0.0.1，小程序可能无法访问。`,
    actionHref: "/cms/products",
    metadata: { field },
  });
}

/** Pending reminder 过期 */
export function issueExpiredReminder(
  reminderId: string,
  customerName: string | null
): DataQualityIssue {
  return createDataQualityIssue({
    severity: "WARNING",
    domain: "CRM",
    entityType: "CustomerReminder",
    entityId: reminderId,
    title: "复购提醒已过期",
    message: `客户「${customerName ?? "未知"}」的待跟进提醒已超过 7 天未处理。`,
    actionHref: "/wms/crm/reminders",
  });
}
