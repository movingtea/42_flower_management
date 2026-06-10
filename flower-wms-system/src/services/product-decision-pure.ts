import { Prisma } from "@/generated/prisma/client";
import { decimalToString, money, ratio, type DecimalInput } from "@/services/order-cost-pure";
import { roundFlowerPrice } from "@/services/product-margin-pure";

export type ProductDecisionTag =
  | "RECOMMEND_PROMOTE"
  | "OBSERVE"
  | "LOW_MARGIN"
  | "HIGH_LOSS_SENSITIVITY"
  | "PRICE_INCREASE_SUGGESTED"
  | "RECIPE_OPTIMIZATION_SUGGESTED"
  | "IMAGE_PRODUCT"
  | "DATA_INSUFFICIENT"
  | "HEALTHY_MARGIN"
  | "GOOD_SALES"
  | "LOW_SALES"
  | "COST_STRUCTURE_RISK"
  | "PACKAGING_COST_RISK"
  | "MISSING_RECIPE"
  | "MISSING_COST_DATA";

export type ProductHealthStatus =
  | "RECOMMENDED"
  | "HEALTHY"
  | "OBSERVE"
  | "RISKY"
  | "LOW_MARGIN"
  | "IMAGE_ONLY"
  | "INCOMPLETE_DATA";

export type TagSeverity = "success" | "info" | "warning" | "danger" | "neutral";

export type ProductDecisionTagDto = {
  key: ProductDecisionTag;
  label: string;
  reason: string;
  severity: TagSeverity;
};

export type LossSensitivityLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export const PRODUCT_DECISION_TAG_LABELS: Record<ProductDecisionTag, string> = {
  RECOMMEND_PROMOTE: "推荐主推",
  OBSERVE: "继续观察",
  LOW_MARGIN: "低毛利",
  HIGH_LOSS_SENSITIVITY: "损耗敏感",
  PRICE_INCREASE_SUGGESTED: "建议调价",
  RECIPE_OPTIMIZATION_SUGGESTED: "建议优化配方",
  IMAGE_PRODUCT: "形象款",
  DATA_INSUFFICIENT: "数据不足",
  HEALTHY_MARGIN: "毛利健康",
  GOOD_SALES: "销量较好",
  LOW_SALES: "销量偏低",
  COST_STRUCTURE_RISK: "成本结构风险",
  PACKAGING_COST_RISK: "包装成本偏高",
  MISSING_RECIPE: "未绑定配方",
  MISSING_COST_DATA: "成本数据不完整",
};

export const PRODUCT_HEALTH_STATUS_LABELS: Record<ProductHealthStatus, string> = {
  RECOMMENDED: "推荐主推",
  HEALTHY: "健康",
  OBSERVE: "继续观察",
  RISKY: "利润风险高",
  LOW_MARGIN: "低毛利",
  IMAGE_ONLY: "形象款",
  INCOMPLETE_DATA: "数据不完整",
};

const LOSS_SENSITIVITY_THRESHOLDS = {
  LOW_MAX: 0.05,
  MEDIUM_MAX: 0.12,
} as const;

const HEALTH_THRESHOLDS = {
  LOW_STANDARD_MARGIN: 0.4,
  LOW_CONSERVATIVE_MARGIN: 0.35,
  HEALTHY_STANDARD_MARGIN: 0.5,
  RECOMMENDED_STANDARD_MARGIN: 0.55,
  RECOMMENDED_CONSERVATIVE_MARGIN: 0.45,
  RECOMMENDED_MIN_ORDERS: 3,
  OBSERVE_MAX_ORDERS: 1,
  PACKAGING_COST_RATIO: 0.25,
  HIGH_SALES_AMOUNT: 500,
  IMAGE_PRODUCT_MIN_PRICE: 200,
  DEFAULT_TARGET_MARGIN: 0.6,
} as const;

export type CalculateLossSensitivityInput = {
  optimisticGrossMargin?: number | null;
  standardGrossMargin?: number | null;
  conservativeGrossMargin?: number | null;
};

export type LossSensitivityResult = {
  marginDropFromOptimisticToStandard: number | null;
  marginDropFromStandardToConservative: number | null;
  totalMarginDrop: number | null;
  sensitivityLevel: LossSensitivityLevel;
  warnings: string[];
};

export type SuggestedPriceMode = "STANDARD" | "CONSERVATIVE";

export type CalculateSuggestedPricesInput = {
  standardTotalCost: DecimalInput;
  conservativeTotalCost?: DecimalInput;
  targetMargins?: readonly number[];
  roundingRule?: "flower";
  includeConservativeWhenHighSensitivity?: boolean;
  lossSensitivityLevel?: LossSensitivityLevel;
};

export type SuggestedPriceItem = {
  targetMargin: number;
  basedOnMode: SuggestedPriceMode;
  suggestedPrice: string;
  roundedSuggestedPrice: string;
};

export type EvaluateProductHealthInput = {
  salesAmount: number;
  orderCount: number;
  rawGrossMargin?: number | null;
  standardGrossMargin?: number | null;
  conservativeGrossMargin?: number | null;
  lossSensitivityLevel?: LossSensitivityLevel;
  hasRecipe: boolean;
  hasCompleteCostData: boolean;
  isActive: boolean;
  productPrice: number;
  standardTotalCost: number;
  conservativeTotalCost: number;
  packagingCostRatio?: number | null;
  dataWindowDays?: number;
  targetMargin?: number;
};

export type ProductHealthResult = {
  healthStatus: ProductHealthStatus;
  score: number;
  tags: ProductDecisionTagDto[];
  reasons: string[];
  warnings: string[];
};

export type GenerateProductDecisionTagsInput = EvaluateProductHealthInput & {
  healthStatus: ProductHealthStatus;
  lossSensitivityLevel: LossSensitivityLevel;
  totalMarginDrop?: number | null;
  materialCostRatio?: number | null;
  packagingCostRatio?: number | null;
  lossExtraCostRatio?: number | null;
};

export type CalculateCostStructureRiskInput = {
  materialCost: DecimalInput;
  packagingCost: DecimalInput;
  deliveryCost?: DecimalInput;
  totalCost: DecimalInput;
  lossModelExtraCost?: DecimalInput;
};

export type CostStructureRiskResult = {
  materialCostRatio: number | null;
  packagingCostRatio: number | null;
  lossExtraCostRatio: number | null;
  riskTags: ProductDecisionTagDto[];
  warnings: string[];
};

function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value;
}

function roundMargin(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function marginDrop(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return roundMargin(Math.max(0, from - to));
}

function makeTag(
  key: ProductDecisionTag,
  reason: string,
  severity: TagSeverity
): ProductDecisionTagDto {
  return {
    key,
    label: PRODUCT_DECISION_TAG_LABELS[key],
    reason,
    severity,
  };
}

function safeRatio(numerator: DecimalInput, denominator: DecimalInput): number | null {
  const denom = money(denominator);
  if (!denom.greaterThan(0)) return null;
  return Number(ratio(money(numerator).div(denom)));
}

export function calculateLossSensitivity(
  input: CalculateLossSensitivityInput
): LossSensitivityResult {
  const optimistic = finiteOrNull(input.optimisticGrossMargin);
  const standard = finiteOrNull(input.standardGrossMargin);
  const conservative = finiteOrNull(input.conservativeGrossMargin);
  const warnings: string[] = [];

  if (optimistic === null || standard === null || conservative === null) {
    warnings.push("三档损耗毛利数据不完整，无法准确评估损耗敏感度。");
    return {
      marginDropFromOptimisticToStandard: null,
      marginDropFromStandardToConservative: null,
      totalMarginDrop: null,
      sensitivityLevel: "UNKNOWN",
      warnings,
    };
  }

  const dropOptimisticToStandard = marginDrop(optimistic, standard)!;
  const dropStandardToConservative = marginDrop(standard, conservative)!;
  const totalDrop = marginDrop(optimistic, conservative)!;

  let sensitivityLevel: LossSensitivityLevel;
  if (totalDrop < LOSS_SENSITIVITY_THRESHOLDS.LOW_MAX) {
    sensitivityLevel = "LOW";
  } else if (totalDrop < LOSS_SENSITIVITY_THRESHOLDS.MEDIUM_MAX) {
    sensitivityLevel = "MEDIUM";
  } else {
    sensitivityLevel = "HIGH";
  }

  return {
    marginDropFromOptimisticToStandard: dropOptimisticToStandard,
    marginDropFromStandardToConservative: dropStandardToConservative,
    totalMarginDrop: totalDrop,
    sensitivityLevel,
    warnings,
  };
}

export function calculateSuggestedPricesByTargetMargins(
  input: CalculateSuggestedPricesInput
): SuggestedPriceItem[] {
  const standardCost = money(input.standardTotalCost);
  const conservativeCost = money(input.conservativeTotalCost ?? input.standardTotalCost);
  const targets = input.targetMargins ?? [0.5, 0.55, 0.6, 0.65];
  const includeConservative =
    input.includeConservativeWhenHighSensitivity === true ||
    input.lossSensitivityLevel === "HIGH" ||
    input.lossSensitivityLevel === "MEDIUM";
  const results: SuggestedPriceItem[] = [];

  for (const target of targets) {
    if (!Number.isFinite(target) || target <= 0 || target >= 1) continue;

    const standardRaw = standardCost.greaterThan(0)
      ? standardCost.div(new Prisma.Decimal(1).minus(target))
      : money(0);
    results.push({
      targetMargin: target,
      basedOnMode: "STANDARD",
      suggestedPrice: decimalToString(standardRaw),
      roundedSuggestedPrice: decimalToString(roundFlowerPrice(standardRaw)),
    });

    if (includeConservative) {
      const conservativeRaw = conservativeCost.greaterThan(0)
        ? conservativeCost.div(new Prisma.Decimal(1).minus(target))
        : money(0);
      results.push({
        targetMargin: target,
        basedOnMode: "CONSERVATIVE",
        suggestedPrice: decimalToString(conservativeRaw),
        roundedSuggestedPrice: decimalToString(roundFlowerPrice(conservativeRaw)),
      });
    }
  }

  return results;
}

export function calculateCostStructureRisk(
  input: CalculateCostStructureRiskInput
): CostStructureRiskResult {
  const totalCost = money(input.totalCost);
  const warnings: string[] = [];
  const riskTags: ProductDecisionTagDto[] = [];

  if (!totalCost.greaterThan(0)) {
    warnings.push("总成本为 0，无法分析成本结构占比。");
    return {
      materialCostRatio: null,
      packagingCostRatio: null,
      lossExtraCostRatio: null,
      riskTags,
      warnings,
    };
  }

  const materialCostRatio = safeRatio(input.materialCost, totalCost);
  const packagingCostRatio = safeRatio(input.packagingCost, totalCost);
  const lossExtraCostRatio = safeRatio(input.lossModelExtraCost ?? 0, totalCost);

  if (packagingCostRatio !== null && packagingCostRatio > HEALTH_THRESHOLDS.PACKAGING_COST_RATIO) {
    riskTags.push(
      makeTag(
        "PACKAGING_COST_RISK",
        `包装成本占总成本 ${(packagingCostRatio * 100).toFixed(1)}%，占比偏高，建议优化包装方案。`,
        "warning"
      )
    );
  }

  if (lossExtraCostRatio !== null && lossExtraCostRatio > 0.15) {
    riskTags.push(
      makeTag(
        "HIGH_LOSS_SENSITIVITY",
        `损耗模型额外成本占总成本 ${(lossExtraCostRatio * 100).toFixed(1)}%，损耗影响偏高。`,
        "warning"
      )
    );
    warnings.push("损耗模型对成本影响较大，定价和备货需预留损耗缓冲。");
  }

  if (materialCostRatio !== null && materialCostRatio > 0.75) {
    riskTags.push(
      makeTag(
        "COST_STRUCTURE_RISK",
        `花材成本占总成本 ${(materialCostRatio * 100).toFixed(1)}%，花材占比偏高，需关注毛利空间。`,
        "info"
      )
    );
  }

  return {
    materialCostRatio,
    packagingCostRatio,
    lossExtraCostRatio,
    riskTags,
    warnings,
  };
}

export function generateProductDecisionTags(
  input: GenerateProductDecisionTagsInput
): ProductDecisionTagDto[] {
  const tags: ProductDecisionTagDto[] = [];
  const targetMargin = input.targetMargin ?? HEALTH_THRESHOLDS.DEFAULT_TARGET_MARGIN;
  const standardMargin = finiteOrNull(input.standardGrossMargin);
  const conservativeMargin = finiteOrNull(input.conservativeGrossMargin);
  const suggestedMinPrice =
    input.standardTotalCost > 0 && targetMargin < 1
      ? input.standardTotalCost / (1 - targetMargin)
      : null;

  if (!input.hasRecipe) {
    tags.push(
      makeTag("MISSING_RECIPE", "该 SKU 未绑定配方，无法准确预估成本和毛利。", "danger")
    );
  }

  if (!input.hasCompleteCostData) {
    tags.push(
      makeTag(
        "MISSING_COST_DATA",
        "配方或花材标准成本数据不完整，当前毛利估算仅供参考。",
        "warning"
      )
    );
  }

  if (input.healthStatus === "RECOMMENDED") {
    tags.push(
      makeTag(
        "RECOMMEND_PROMOTE",
        "标准与保守损耗模式下毛利均较健康，且近期订单量达标，适合作为主推款。",
        "success"
      )
    );
  }

  if (standardMargin !== null && standardMargin < HEALTH_THRESHOLDS.LOW_STANDARD_MARGIN) {
    tags.push(
      makeTag(
        "LOW_MARGIN",
        `标准损耗模式下毛利率仅 ${(standardMargin * 100).toFixed(1)}%，低于 40% 经营红线。`,
        "danger"
      )
    );
  } else if (
    standardMargin !== null &&
    standardMargin >= HEALTH_THRESHOLDS.HEALTHY_STANDARD_MARGIN
  ) {
    tags.push(
      makeTag(
        "HEALTHY_MARGIN",
        `标准损耗模式下毛利率 ${(standardMargin * 100).toFixed(1)}%，处于健康区间。`,
        "success"
      )
    );
  }

  if (
    conservativeMargin !== null &&
    conservativeMargin < HEALTH_THRESHOLDS.LOW_CONSERVATIVE_MARGIN
  ) {
    tags.push(
      makeTag(
        "HIGH_LOSS_SENSITIVITY",
        `保守损耗模式下毛利率仅 ${(conservativeMargin * 100).toFixed(1)}%，损耗波动时利润风险较高。`,
        "danger"
      )
    );
  } else if (input.lossSensitivityLevel === "HIGH") {
    tags.push(
      makeTag(
        "HIGH_LOSS_SENSITIVITY",
        "三档损耗毛利差距较大，产品对花材损耗较为敏感。",
        "warning"
      )
    );
  }

  if (
    suggestedMinPrice !== null &&
    input.productPrice > 0 &&
    input.productPrice < suggestedMinPrice * 0.95
  ) {
    tags.push(
      makeTag(
        "PRICE_INCREASE_SUGGESTED",
        `当前售价低于目标毛利率 ${(targetMargin * 100).toFixed(0)}% 下的建议价，建议评估调价。`,
        "warning"
      )
    );
  }

  const packagingRatio = finiteOrNull(input.packagingCostRatio);
  if (packagingRatio !== null && packagingRatio > HEALTH_THRESHOLDS.PACKAGING_COST_RATIO) {
    tags.push(
      makeTag(
        "PACKAGING_COST_RISK",
        `包装成本占总成本 ${(packagingRatio * 100).toFixed(1)}%，包装占比偏高。`,
        "warning"
      )
    );
  }

  if (
    input.salesAmount >= HEALTH_THRESHOLDS.HIGH_SALES_AMOUNT &&
    conservativeMargin !== null &&
    conservativeMargin < HEALTH_THRESHOLDS.HEALTHY_STANDARD_MARGIN
  ) {
    tags.push(
      makeTag(
        "RECIPE_OPTIMIZATION_SUGGESTED",
        "近期销量较好，但保守损耗模式下毛利偏低，建议优化配方或花材搭配。",
        "warning"
      )
    );
  }

  if (input.orderCount <= HEALTH_THRESHOLDS.OBSERVE_MAX_ORDERS) {
    tags.push(
      makeTag(
        "DATA_INSUFFICIENT",
        `统计周期内仅 ${input.orderCount} 笔订单，样本量不足，建议继续观察。`,
        "neutral"
      )
    );
    tags.push(makeTag("OBSERVE", "销售样本偏少，暂不宜作为大批量备货依据。", "info"));
  } else if (input.orderCount >= HEALTH_THRESHOLDS.RECOMMENDED_MIN_ORDERS) {
    tags.push(makeTag("GOOD_SALES", `近期成交 ${input.orderCount} 笔，销量表现较好。`, "success"));
  } else {
    tags.push(makeTag("LOW_SALES", `近期仅成交 ${input.orderCount} 笔，销量偏低。`, "info"));
  }

  if (input.healthStatus === "IMAGE_ONLY") {
    tags.push(
      makeTag(
        "IMAGE_PRODUCT",
        "售价较高但近期销量有限，更适合作为形象展示款，不宜大量备货。",
        "info"
      )
    );
  }

  const deduped = new Map<ProductDecisionTag, ProductDecisionTagDto>();
  for (const tag of tags) {
    if (!deduped.has(tag.key)) deduped.set(tag.key, tag);
  }
  return [...deduped.values()];
}

export function evaluateProductHealth(
  input: EvaluateProductHealthInput
): ProductHealthResult {
  const warnings: string[] = [];
  const reasons: string[] = [];
  const standardMargin = finiteOrNull(input.standardGrossMargin);
  const conservativeMargin = finiteOrNull(input.conservativeGrossMargin);
  const lossSensitivityLevel = input.lossSensitivityLevel ?? "UNKNOWN";
  const targetMargin = input.targetMargin ?? HEALTH_THRESHOLDS.DEFAULT_TARGET_MARGIN;
  const packagingRatio = finiteOrNull(input.packagingCostRatio) ?? 0;

  let healthStatus: ProductHealthStatus = "OBSERVE";
  let score = 50;

  if (!input.hasRecipe || !input.hasCompleteCostData) {
    healthStatus = "INCOMPLETE_DATA";
    score = 20;
    if (!input.hasRecipe) {
      reasons.push("未绑定配方，成本与毛利无法准确估算。");
    }
    if (!input.hasCompleteCostData) {
      reasons.push("花材或包装成本数据不完整，决策结论仅供参考。");
    }
  } else if (
    conservativeMargin !== null &&
    conservativeMargin < HEALTH_THRESHOLDS.LOW_CONSERVATIVE_MARGIN
  ) {
    healthStatus = "RISKY";
    score = 25;
    reasons.push("保守损耗模式下毛利偏低，花材损耗波动时利润风险较高。");
    score -= 20;
  } else if (
    standardMargin !== null &&
    standardMargin < HEALTH_THRESHOLDS.LOW_STANDARD_MARGIN
  ) {
    healthStatus = "LOW_MARGIN";
    score = 35;
    reasons.push("标准损耗模式下毛利率低于 40%，需重点关注定价与成本。");
    score -= 25;
  } else if (
    standardMargin !== null &&
    conservativeMargin !== null &&
    standardMargin >= HEALTH_THRESHOLDS.RECOMMENDED_STANDARD_MARGIN &&
    conservativeMargin >= HEALTH_THRESHOLDS.RECOMMENDED_CONSERVATIVE_MARGIN &&
    input.orderCount >= HEALTH_THRESHOLDS.RECOMMENDED_MIN_ORDERS
  ) {
    healthStatus = "RECOMMENDED";
    score = 88;
    reasons.push("毛利健康且近期销量达标，适合作为主推产品。");
    score += 20;
  } else if (
    standardMargin !== null &&
    standardMargin >= HEALTH_THRESHOLDS.HEALTHY_STANDARD_MARGIN
  ) {
    healthStatus = "HEALTHY";
    score = 72;
    reasons.push("标准损耗模式下毛利处于健康区间。");
    score += 12;
  }

  if (input.orderCount <= HEALTH_THRESHOLDS.OBSERVE_MAX_ORDERS && healthStatus !== "INCOMPLETE_DATA") {
    if (
      healthStatus === "HEALTHY" &&
      input.productPrice >= HEALTH_THRESHOLDS.IMAGE_PRODUCT_MIN_PRICE
    ) {
      healthStatus = "IMAGE_ONLY";
      reasons.push("售价较高但近期几乎无成交，更像形象展示款。");
      score = Math.min(score, 55);
    } else if (healthStatus !== "RECOMMENDED") {
      healthStatus = "OBSERVE";
      reasons.push("统计周期内订单样本偏少，建议继续观察后再做经营决策。");
      score -= 15;
    }
  }

  if (packagingRatio > HEALTH_THRESHOLDS.PACKAGING_COST_RATIO) {
    warnings.push("包装成本占比较高，建议评估包装方案是否有优化空间。");
    score -= 8;
  }

  if (lossSensitivityLevel === "HIGH") {
    warnings.push("产品对花材损耗较为敏感，备货和定价需预留缓冲。");
    score -= 8;
  }

  const suggestedMinPrice =
    input.standardTotalCost > 0 && targetMargin < 1
      ? input.standardTotalCost / (1 - targetMargin)
      : null;
  if (
    suggestedMinPrice !== null &&
    input.productPrice > 0 &&
    input.productPrice < suggestedMinPrice * 0.95
  ) {
    warnings.push(
      `当前售价低于目标毛利率 ${(targetMargin * 100).toFixed(0)}% 的建议价，可考虑适度调价。`
    );
    score -= 10;
  }

  if (!input.isActive) {
    warnings.push("商品当前未上架，经营数据仅供复盘参考。");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const tags = generateProductDecisionTags({
    ...input,
    healthStatus,
    lossSensitivityLevel,
    packagingCostRatio: packagingRatio,
  });

  return {
    healthStatus,
    score,
    tags,
    reasons,
    warnings,
  };
}

export function buildProductDecisionRankings<
  T extends {
    skuId: string;
    productId: string;
    productName: string;
    skuName: string;
    health: { status: ProductHealthStatus; score: number };
    marginEstimates: { standard: number | null; conservative: number | null };
    lossSensitivity: { totalMarginDrop: number | null };
    suggestedPrices: SuggestedPriceItem[];
    price: string;
  }
>(products: T[], targetMargin: number = HEALTH_THRESHOLDS.DEFAULT_TARGET_MARGIN) {
  const recommendedProducts = products
    .filter((item) => item.health.status === "RECOMMENDED")
    .sort((a, b) => b.health.score - a.health.score)
    .slice(0, 10);

  const lowMarginProducts = products
    .filter(
      (item) =>
        item.health.status === "LOW_MARGIN" ||
        (item.marginEstimates.standard !== null &&
          item.marginEstimates.standard < HEALTH_THRESHOLDS.LOW_STANDARD_MARGIN)
    )
    .sort((a, b) => (a.marginEstimates.standard ?? 0) - (b.marginEstimates.standard ?? 0))
    .slice(0, 10);

  const highLossSensitivityProducts = products
    .filter((item) => item.lossSensitivity.totalMarginDrop !== null)
    .sort(
      (a, b) =>
        (b.lossSensitivity.totalMarginDrop ?? 0) - (a.lossSensitivity.totalMarginDrop ?? 0)
    )
    .slice(0, 10);

  const priceIncreaseSuggestedProducts = products
    .filter((item) => {
      const standardCost = Number(
        item.suggestedPrices.find(
          (price) =>
            price.basedOnMode === "STANDARD" &&
            Math.abs(price.targetMargin - targetMargin) < 0.001
        )?.suggestedPrice ?? 0
      );
      const currentPrice = Number(item.price);
      return standardCost > 0 && currentPrice > 0 && currentPrice < standardCost * 0.95;
    })
    .sort((a, b) => {
      const gapA =
        Number(
          a.suggestedPrices.find(
            (price) =>
              price.basedOnMode === "STANDARD" &&
              Math.abs(price.targetMargin - targetMargin) < 0.001
          )?.suggestedPrice ?? 0
        ) - Number(a.price);
      const gapB =
        Number(
          b.suggestedPrices.find(
            (price) =>
              price.basedOnMode === "STANDARD" &&
              Math.abs(price.targetMargin - targetMargin) < 0.001
          )?.suggestedPrice ?? 0
        ) - Number(b.price);
      return gapB - gapA;
    })
    .slice(0, 10);

  const incompleteDataProducts = products
    .filter((item) => item.health.status === "INCOMPLETE_DATA")
    .sort((a, b) => a.health.score - b.health.score)
    .slice(0, 10);

  return {
    recommendedProducts,
    lowMarginProducts,
    highLossSensitivityProducts,
    priceIncreaseSuggestedProducts,
    incompleteDataProducts,
  };
}
