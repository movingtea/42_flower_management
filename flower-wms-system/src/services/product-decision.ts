import { Prisma } from "@/generated/prisma/client";
import { OrderStatus, StockLogType } from "@/generated/prisma/enums";
import { serializeReportDateRange } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { getReportDateRange, type ReportDateRangeParams } from "@/services/business-report-pure";
import { decimalToString, money, ratio } from "@/services/order-cost-pure";
import {
  estimateSkuMarginFromRecord,
  productMarginSkuInclude,
  type SkuMarginEstimate,
} from "@/services/product-margin";
import {
  buildProductDecisionRankings,
  calculateCostStructureRisk,
  calculateLossSensitivity,
  calculateSuggestedPricesByTargetMargins,
  evaluateProductHealth,
  PRODUCT_HEALTH_STATUS_LABELS,
  type ProductDecisionTagDto,
  type ProductHealthStatus,
  type SuggestedPriceItem,
} from "@/services/product-decision-pure";

const EFFECTIVE_ORDER_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.PRODUCTION,
  OrderStatus.DELIVERING,
  OrderStatus.COMPLETED,
] as const;

const DEFAULT_LIMIT = 20;

export type ProductDecisionParams = ReportDateRangeParams & {
  productId?: string | null;
  skuId?: string | null;
  categoryId?: string | null;
  status?: "active" | "inactive" | null;
  limit?: number | string | null;
  includeInactive?: boolean | string | null;
  targetMargin?: number | string | null;
};

type DateRangeDto = {
  startDate: string;
  endDate: string;
  label: string;
};

export type ProductDecisionSales = {
  orderCount: number;
  quantitySold: number;
  salesAmount: string;
  averageSellingPrice: string;
};

export type ProductDecisionMarginEstimates = {
  raw: number | null;
  optimistic: number | null;
  standard: number | null;
  conservative: number | null;
};

export type ProductDecisionActualPerformance = {
  actualGrossProfit: string | null;
  actualGrossMargin: number | null;
  lossAdjustedGrossProfit: string | null;
  lossAdjustedGrossMargin: number | null;
  hasActualData: boolean;
};

export type ProductDecisionLossSensitivity = {
  level: string;
  totalMarginDrop: number | null;
  marginDropFromStandardToConservative: number | null;
};

export type ProductDecisionCostStructure = {
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  materialCostRatio: number | null;
  packagingCostRatio: number | null;
  lossModelExtraCost: string;
  lossExtraCostRatio: number | null;
};

export type ProductDecisionHealth = {
  status: ProductHealthStatus;
  statusLabel: string;
  score: number;
  tags: ProductDecisionTagDto[];
  reasons: string[];
  warnings: string[];
};

export type ProductDecisionItem = {
  productId: string;
  productName: string;
  skuId: string;
  skuName: string;
  price: string;
  categoryName: string | null;
  isActive: boolean;
  sales: ProductDecisionSales;
  marginEstimates: ProductDecisionMarginEstimates;
  actualPerformance: ProductDecisionActualPerformance;
  lossSensitivity: ProductDecisionLossSensitivity;
  suggestedPrices: SuggestedPriceItem[];
  costStructure: ProductDecisionCostStructure;
  health: ProductDecisionHealth;
};

export type ProductDecisionSummary = {
  productCount: number;
  skuCount: number;
  activeSkuCount: number;
  recommendedCount: number;
  observeCount: number;
  riskyCount: number;
  lowMarginCount: number;
  incompleteDataCount: number;
  totalSalesAmount: string;
  totalOrderCount: number;
  averageStandardGrossMargin: number | null;
  averageConservativeGrossMargin: number | null;
  warnings: string[];
};

export type ProductDecisionReport = {
  dateRange: DateRangeDto;
  summary: ProductDecisionSummary;
  products: ProductDecisionItem[];
  rankings: ReturnType<typeof buildProductDecisionRankings<ProductDecisionItem>>;
  warnings: string[];
};

type SkuSalesAggregate = {
  orderIds: Set<string>;
  quantitySold: number;
  salesAmount: Prisma.Decimal;
  actualGrossProfit: Prisma.Decimal;
  hasSnapshotData: boolean;
};

function moneyString(value: Prisma.Decimal | number | string | null | undefined): string {
  return decimalToString(money(value));
}

function safeLimit(limit: ProductDecisionParams["limit"], fallback = DEFAULT_LIMIT): number {
  const value = Number(limit ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), 100);
}

function parseTargetMargin(value: ProductDecisionParams["targetMargin"]): number {
  const parsed = Number(value ?? 0.6);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return 0.6;
  return parsed;
}

function parseIncludeInactive(value: ProductDecisionParams["includeInactive"]): boolean {
  return value === true || value === "true" || value === "1";
}

function serializeRange(range: { startDate: Date; endDate: Date; label: string }): DateRangeDto {
  return serializeReportDateRange(range);
}

function reportOrderDateWhere(startDate: Date, endDate: Date): Prisma.OrderWhereInput {
  return {
    OR: [
      { paidAt: { gte: startDate, lt: endDate } },
      { paidAt: null, createdAt: { gte: startDate, lt: endDate } },
    ],
  };
}

function nonRefundedWhere(): Prisma.OrderWhereInput {
  return {
    refundTime: null,
    OR: [{ refundAmount: null }, { refundAmount: { lte: 0 } }],
  };
}

function effectiveOrderWhere(startDate: Date, endDate: Date): Prisma.OrderWhereInput {
  return {
    AND: [
      reportOrderDateWhere(startDate, endDate),
      { status: { in: [...EFFECTIVE_ORDER_STATUSES] } },
      nonRefundedWhere(),
    ],
  };
}

function marginNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCompleteCostData(estimate: SkuMarginEstimate): boolean {
  if (!estimate.recipeId) return false;
  const hasMissingMaterial = estimate.lines.some((line) => line.standardUnitCost === null);
  const hasMissingPackaging = !estimate.packagingLine;
  return !hasMissingMaterial && !hasMissingPackaging;
}

function dataWindowDays(range: { startDate: Date; endDate: Date }): number {
  const ms = range.endDate.getTime() - range.startDate.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

async function aggregateSkuSales(
  range: { startDate: Date; endDate: Date },
  skuFilter?: string | null
): Promise<Map<string, SkuSalesAggregate>> {
  const orders = await prisma.order.findMany({
    where: effectiveOrderWhere(range.startDate, range.endDate),
    select: {
      id: true,
      payAmount: true,
      costSnapshot: {
        select: {
          paidAmount: true,
          flowerMaterialCost: true,
          packagingCost: true,
          deliveryCostActual: true,
          platformFee: true,
          floristLaborCost: true,
          otherCost: true,
        },
      },
      items: {
        where: skuFilter ? { skuId: skuFilter } : undefined,
        select: {
          id: true,
          skuId: true,
          quantity: true,
          snapshotPrice: true,
        },
      },
    },
  });

  const orderIds = orders.map((order) => order.id);
  const saleOutLogs =
    orderIds.length > 0
      ? await prisma.stockLog.findMany({
          where: {
            orderId: { in: orderIds },
            orderItemId: { not: null },
            type: StockLogType.SALE_OUT,
          },
          select: {
            orderItemId: true,
            quantity: true,
            batch: { select: { unitCost: true } },
          },
        })
      : [];

  const flowerCostByOrderItem = new Map<string, Prisma.Decimal>();
  for (const log of saleOutLogs) {
    if (!log.orderItemId) continue;
    const lineCost = money(log.batch.unitCost).times(log.quantity);
    flowerCostByOrderItem.set(
      log.orderItemId,
      money((flowerCostByOrderItem.get(log.orderItemId) ?? money(0)).plus(lineCost))
    );
  }

  const salesBySku = new Map<string, SkuSalesAggregate>();

  for (const order of orders) {
    const itemSubtotal = order.items.reduce(
      (sum, item) => money(sum.plus(money(item.snapshotPrice).times(item.quantity))),
      money(0)
    );
    const paidAmount = money(order.costSnapshot?.paidAmount ?? order.payAmount);
    const snapshot = order.costSnapshot;

    for (const item of order.items) {
      const itemAmount = money(item.snapshotPrice).times(item.quantity);
      const itemRatio =
        itemSubtotal.greaterThan(0) && paidAmount.greaterThan(0)
          ? ratio(itemAmount.div(itemSubtotal))
          : ratio(0);
      const paidAllocated = money(paidAmount.times(itemRatio));
      const allocatedFlower = snapshot
        ? money(snapshot.flowerMaterialCost).times(itemRatio)
        : money(0);
      const preciseFlower = flowerCostByOrderItem.get(item.id);
      const flowerMaterialCost = money(preciseFlower ?? allocatedFlower);
      const packagingCost = snapshot ? money(snapshot.packagingCost).times(itemRatio) : money(0);
      const deliveryCostAllocated = snapshot
        ? money(snapshot.deliveryCostActual).times(itemRatio)
        : money(0);
      const extraAllocated = snapshot
        ? money(snapshot.platformFee)
            .plus(snapshot.floristLaborCost)
            .plus(snapshot.otherCost)
            .times(itemRatio)
        : money(0);
      const totalCost = money(
        flowerMaterialCost.plus(packagingCost).plus(deliveryCostAllocated).plus(extraAllocated)
      );
      const grossProfit = money(paidAllocated.minus(totalCost));

      const current =
        salesBySku.get(item.skuId) ??
        ({
          orderIds: new Set<string>(),
          quantitySold: 0,
          salesAmount: money(0),
          actualGrossProfit: money(0),
          hasSnapshotData: false,
        } satisfies SkuSalesAggregate);

      current.orderIds.add(order.id);
      current.quantitySold += item.quantity;
      current.salesAmount = money(current.salesAmount.plus(paidAllocated));
      current.actualGrossProfit = money(current.actualGrossProfit.plus(grossProfit));
      if (snapshot) current.hasSnapshotData = true;
      salesBySku.set(item.skuId, current);
    }
  }

  return salesBySku;
}

function buildSkuDecisionItem(input: {
  sku: {
    id: string;
    specName: string;
    price: Prisma.Decimal;
    spu: {
      id: string;
      name: string;
      isActive: boolean;
      categories: Array<{ productCategory: { name: string } }>;
    };
  };
  marginEstimate: SkuMarginEstimate;
  sales: SkuSalesAggregate | undefined;
  targetMargin: number;
  windowDays: number;
}): ProductDecisionItem {
  const { sku, marginEstimate, sales, targetMargin, windowDays } = input;
  const categoryName = sku.spu.categories[0]?.productCategory.name ?? null;
  const rawMargin = marginNumber(marginEstimate.rawEstimate.estimatedGrossMargin);
  const optimisticMargin = marginNumber(
    marginEstimate.lossModelEstimates.optimistic.estimatedGrossMargin
  );
  const standardMargin = marginNumber(
    marginEstimate.lossModelEstimates.standard.estimatedGrossMargin
  );
  const conservativeMargin = marginNumber(
    marginEstimate.lossModelEstimates.conservative.estimatedGrossMargin
  );

  const lossSensitivity = calculateLossSensitivity({
    optimisticGrossMargin: optimisticMargin,
    standardGrossMargin: standardMargin,
    conservativeGrossMargin: conservativeMargin,
  });

  const standardTotalCost = Number(marginEstimate.lossModelEstimates.standard.totalCost);
  const conservativeTotalCost = Number(
    marginEstimate.lossModelEstimates.conservative.totalCost
  );
  const suggestedPrices = calculateSuggestedPricesByTargetMargins({
    standardTotalCost,
    conservativeTotalCost,
    targetMargins: [0.5, 0.55, targetMargin, 0.65],
    lossSensitivityLevel: lossSensitivity.sensitivityLevel,
    includeConservativeWhenHighSensitivity: lossSensitivity.sensitivityLevel !== "LOW",
  });

  const materialCost = money(marginEstimate.lossModelEstimates.standard.materialCost);
  const packagingCost = money(marginEstimate.lossModelEstimates.standard.packagingCost);
  const totalCost = money(marginEstimate.lossModelEstimates.standard.totalCost);
  const lossModelExtraCost = money(
    marginEstimate.lossModelEstimates.standard.lossModelExtraCost
  );
  const costStructureRisk = calculateCostStructureRisk({
    materialCost,
    packagingCost,
    totalCost,
    lossModelExtraCost,
  });

  const orderCount = sales?.orderIds.size ?? 0;
  const quantitySold = sales?.quantitySold ?? 0;
  const salesAmount = sales?.salesAmount ?? money(0);
  const averageSellingPrice =
    quantitySold > 0 ? money(salesAmount.div(quantitySold)) : money(0);

  const hasRecipe = Boolean(marginEstimate.recipeId);
  const completeCostData = hasCompleteCostData(marginEstimate);
  const productPrice = Number(marginEstimate.price);

  const healthResult = evaluateProductHealth({
    salesAmount: Number(decimalToString(salesAmount)),
    orderCount,
    rawGrossMargin: rawMargin,
    standardGrossMargin: standardMargin,
    conservativeGrossMargin: conservativeMargin,
    lossSensitivityLevel: lossSensitivity.sensitivityLevel,
    hasRecipe,
    hasCompleteCostData: completeCostData,
    isActive: sku.spu.isActive,
    productPrice,
    standardTotalCost,
    conservativeTotalCost,
    packagingCostRatio: costStructureRisk.packagingCostRatio,
    dataWindowDays: windowDays,
    targetMargin,
  });

  const allWarnings = [
    ...marginEstimate.warnings,
    ...lossSensitivity.warnings,
    ...costStructureRisk.warnings,
    ...healthResult.warnings,
  ];

  const hasActualData = Boolean(sales && sales.hasSnapshotData && orderCount > 0);
  let actualGrossProfit: string | null = null;
  let actualGrossMargin: number | null = null;
  let lossAdjustedGrossProfit: string | null = null;
  let lossAdjustedGrossMargin: number | null = null;

  if (hasActualData && sales) {
    actualGrossProfit = moneyString(sales.actualGrossProfit);
    actualGrossMargin =
      sales.salesAmount.greaterThan(0)
        ? Number(ratio(sales.actualGrossProfit.div(sales.salesAmount)))
        : null;

    const standardCostTotal = money(standardTotalCost).times(quantitySold);
    lossAdjustedGrossProfit = moneyString(money(sales.salesAmount.minus(standardCostTotal)));
    lossAdjustedGrossMargin = sales.salesAmount.greaterThan(0)
      ? Number(ratio(money(sales.salesAmount.minus(standardCostTotal)).div(sales.salesAmount)))
      : null;
  }

  const extraTags = costStructureRisk.riskTags.filter(
    (tag) => !healthResult.tags.some((existing) => existing.key === tag.key)
  );

  return {
    productId: sku.spu.id,
    productName: sku.spu.name,
    skuId: sku.id,
    skuName: sku.specName,
    price: marginEstimate.price,
    categoryName,
    isActive: sku.spu.isActive,
    sales: {
      orderCount,
      quantitySold,
      salesAmount: moneyString(salesAmount),
      averageSellingPrice: moneyString(averageSellingPrice),
    },
    marginEstimates: {
      raw: rawMargin,
      optimistic: optimisticMargin,
      standard: standardMargin,
      conservative: conservativeMargin,
    },
    actualPerformance: {
      actualGrossProfit,
      actualGrossMargin,
      lossAdjustedGrossProfit,
      lossAdjustedGrossMargin,
      hasActualData,
    },
    lossSensitivity: {
      level: lossSensitivity.sensitivityLevel,
      totalMarginDrop: lossSensitivity.totalMarginDrop,
      marginDropFromStandardToConservative:
        lossSensitivity.marginDropFromStandardToConservative,
    },
    suggestedPrices,
    costStructure: {
      materialCost: moneyString(materialCost),
      packagingCost: moneyString(packagingCost),
      totalCost: moneyString(totalCost),
      materialCostRatio: costStructureRisk.materialCostRatio,
      packagingCostRatio: costStructureRisk.packagingCostRatio,
      lossModelExtraCost: moneyString(lossModelExtraCost),
      lossExtraCostRatio: costStructureRisk.lossExtraCostRatio,
    },
    health: {
      status: healthResult.healthStatus,
      statusLabel: PRODUCT_HEALTH_STATUS_LABELS[healthResult.healthStatus],
      score: healthResult.score,
      tags: [...healthResult.tags, ...extraTags],
      reasons: healthResult.reasons,
      warnings: allWarnings,
    },
  };
}

function buildSummary(products: ProductDecisionItem[]): ProductDecisionSummary {
  const productIds = new Set(products.map((item) => item.productId));
  const standardMargins = products
    .map((item) => item.marginEstimates.standard)
    .filter((value): value is number => value !== null);
  const conservativeMargins = products
    .map((item) => item.marginEstimates.conservative)
    .filter((value): value is number => value !== null);

  const totalSalesAmount = products.reduce(
    (sum, item) => money(sum.plus(item.sales.salesAmount)),
    money(0)
  );
  const totalOrderCount = products.reduce((sum, item) => sum + item.sales.orderCount, 0);

  return {
    productCount: productIds.size,
    skuCount: products.length,
    activeSkuCount: products.filter((item) => item.isActive).length,
    recommendedCount: products.filter((item) => item.health.status === "RECOMMENDED").length,
    observeCount: products.filter((item) => item.health.status === "OBSERVE").length,
    riskyCount: products.filter((item) => item.health.status === "RISKY").length,
    lowMarginCount: products.filter((item) => item.health.status === "LOW_MARGIN").length,
    incompleteDataCount: products.filter((item) => item.health.status === "INCOMPLETE_DATA")
      .length,
    totalSalesAmount: moneyString(totalSalesAmount),
    totalOrderCount,
    averageStandardGrossMargin:
      standardMargins.length > 0
        ? standardMargins.reduce((sum, value) => sum + value, 0) / standardMargins.length
        : null,
    averageConservativeGrossMargin:
      conservativeMargins.length > 0
        ? conservativeMargins.reduce((sum, value) => sum + value, 0) / conservativeMargins.length
        : null,
    warnings: [],
  };
}

export async function getProductDecisionReport(
  params: ProductDecisionParams = {}
): Promise<ProductDecisionReport> {
  const range = getReportDateRange(params);
  const limit = safeLimit(params.limit);
  const targetMargin = parseTargetMargin(params.targetMargin);
  const includeInactive = parseIncludeInactive(params.includeInactive);
  const windowDays = dataWindowDays(range);

  const spuWhere: Prisma.ProductSpuWhereInput = {
    isDeleted: false,
  };

  if (!includeInactive) {
    if (params.status === "inactive") {
      spuWhere.isActive = false;
    } else if (params.status === "active") {
      spuWhere.isActive = true;
    } else {
      spuWhere.isActive = true;
    }
  } else if (params.status === "active") {
    spuWhere.isActive = true;
  } else if (params.status === "inactive") {
    spuWhere.isActive = false;
  }

  if (params.productId) {
    spuWhere.id = params.productId;
  }

  if (params.categoryId) {
    spuWhere.categories = {
      some: { productCategoryId: params.categoryId },
    };
  }

  const skuWhere: Prisma.ProductSkuWhereInput = {
    spu: spuWhere,
  };
  if (params.skuId) {
    skuWhere.id = params.skuId;
  }

  const skus = await prisma.productSku.findMany({
    where: skuWhere,
    include: {
      ...productMarginSkuInclude,
      spu: {
        select: {
          id: true,
          name: true,
          isActive: true,
          categories: {
            select: {
              productCategory: { select: { name: true } },
            },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ spu: { name: "asc" } }, { sortOrder: "asc" }],
  });

  const salesBySku = await aggregateSkuSales(range, params.skuId);

  const allProducts = skus.map((sku) =>
    buildSkuDecisionItem({
      sku,
      marginEstimate: estimateSkuMarginFromRecord(sku),
      sales: salesBySku.get(sku.id),
      targetMargin,
      windowDays,
    })
  );

  const products = [...allProducts]
    .sort((a, b) => b.health.score - a.health.score)
    .slice(0, limit);

  const summary = buildSummary(allProducts);
  const rankings = buildProductDecisionRankings(allProducts, targetMargin);

  const warnings = [
    "产品决策基于配方预估成本、损耗三档模拟与订单分摊口径，标签仅作经营建议，不会自动改价或上下架。",
    "实际毛利按订单项销售额比例分摊订单级成本；若 SALE_OUT 已记录 orderItemId，则花材成本优先按订单项精确归属。",
    "建议售价需结合当地主流价格带与竞品情况综合判断。",
    ...(summary.incompleteDataCount > 0
      ? [`有 ${summary.incompleteDataCount} 个 SKU 成本数据不完整，相关结论仅供参考。`]
      : []),
  ];

  summary.warnings = warnings;

  return {
    dateRange: serializeRange(range),
    summary,
    products,
    rankings,
    warnings,
  };
}

export async function getProductDecisionDetail(
  skuId: string,
  params: ProductDecisionParams = {}
): Promise<ProductDecisionItem> {
  const report = await getProductDecisionReport({
    ...params,
    skuId,
    limit: 1,
  });
  const item = report.products[0];
  if (!item) {
    throw new Error("SKU 不存在或未匹配到产品决策数据");
  }
  return item;
}
