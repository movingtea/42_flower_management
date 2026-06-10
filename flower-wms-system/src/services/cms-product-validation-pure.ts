import type { ProductHealthStatus } from "@/services/product-decision-pure";

export type PublishReadinessStatus =
  | "READY"
  | "WARNING"
  | "BLOCKED"
  | "INCOMPLETE";

export type IssueSeverity = "BLOCKER" | "WARNING" | "INFO";

export type ValidationIssue = {
  code: string;
  severity: IssueSeverity;
  message: string;
  field?: string;
};

export type ValidationCheck = {
  key: string;
  label: string;
  passed: boolean;
  severity: IssueSeverity;
  message?: string;
};

export type SkuMarginEstimateInput = {
  standardGrossMargin?: number | null;
  conservativeGrossMargin?: number | null;
};

export type SkuProductDecisionInput = {
  healthStatus?: ProductHealthStatus | null;
  keyTags?: string[];
};

export type ValidateProductPublishInput = {
  product: {
    id: string;
    name: string;
    status?: string | boolean | null;
    categoryId?: string | null;
    mainImage?: string | null;
    detailImages?: string[] | null;
    description?: string | null;
    story?: string | null;
    occasionTags?: string[] | null;
    colorTags?: string[] | null;
    styleTags?: string[] | null;
    relationshipTags?: string[] | null;
    budgetTags?: string[] | null;
    positioningTags?: string[] | null;
  };
  skus: Array<{
    id: string;
    name: string;
    price: number | string;
    isActive?: boolean;
    stock?: number;
    recipeId?: string | null;
    marginEstimate?: SkuMarginEstimateInput | null;
    productDecision?: SkuProductDecisionInput | null;
  }>;
  options?: {
    targetStandardGrossMargin?: number;
    requireRecipeForPublish?: boolean;
    requireOccasionTags?: boolean;
    strictMode?: boolean;
    allowPreOrder?: boolean;
    inHomeMainSlot?: boolean;
  };
};

export type PublishReadinessResult = {
  overallStatus: PublishReadinessStatus;
  score: number;
  canPublish: boolean;
  canPromote: boolean;
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  checks: ValidationCheck[];
};

const DEFAULT_OPTIONS = {
  targetStandardGrossMargin: 0.4,
  requireRecipeForPublish: false,
  requireOccasionTags: false,
  strictMode: false,
  allowPreOrder: true,
  inHomeMainSlot: false,
};

function parsePrice(price: number | string): number {
  const n = typeof price === "number" ? price : Number(price);
  return Number.isFinite(n) ? n : 0;
}

function isNonEmpty(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasTags(tags: string[] | null | undefined): boolean {
  return Array.isArray(tags) && tags.length > 0;
}

function activeSkus(
  skus: ValidateProductPublishInput["skus"]
): ValidateProductPublishInput["skus"] {
  return skus.filter((sku) => sku.isActive !== false);
}

function worstHealthStatus(
  skus: ValidateProductPublishInput["skus"]
): ProductHealthStatus | null {
  const statuses = skus
    .map((s) => s.productDecision?.healthStatus)
    .filter((s): s is ProductHealthStatus => Boolean(s));
  if (statuses.length === 0) return null;

  const priority: ProductHealthStatus[] = [
    "RISKY",
    "LOW_MARGIN",
    "INCOMPLETE_DATA",
    "IMAGE_ONLY",
    "OBSERVE",
    "HEALTHY",
    "RECOMMENDED",
  ];
  for (const status of priority) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0];
}

function lowestStandardMargin(
  skus: ValidateProductPublishInput["skus"]
): number | null {
  const margins = skus
    .map((s) => s.marginEstimate?.standardGrossMargin)
    .filter((m): m is number => m != null && Number.isFinite(m));
  if (margins.length === 0) return null;
  return Math.min(...margins);
}

function addIssue(
  target: ValidationIssue[],
  issue: ValidationIssue
): void {
  target.push(issue);
}

function addCheck(
  checks: ValidationCheck[],
  check: ValidationCheck
): void {
  checks.push(check);
}

export function validateProductPublishReadiness(
  input: ValidateProductPublishInput
): PublishReadinessResult {
  const opts = { ...DEFAULT_OPTIONS, ...input.options };
  const { product, skus } = input;

  const blockingIssues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const suggestions: ValidationIssue[] = [];
  const checks: ValidationCheck[] = [];

  let score = 100;

  // --- 基础信息 ---
  const hasName = isNonEmpty(product.name);
  addCheck(checks, {
    key: "name",
    label: "商品名称",
    passed: hasName,
    severity: hasName ? "INFO" : "BLOCKER",
    message: hasName ? undefined : "商品名称不能为空",
  });
  if (!hasName) {
    addIssue(blockingIssues, {
      code: "MISSING_NAME",
      severity: "BLOCKER",
      message: "商品名称不能为空",
      field: "name",
    });
    score -= 15;
  }

  const hasCategory = isNonEmpty(product.categoryId ?? "");
  addCheck(checks, {
    key: "category",
    label: "商品分类",
    passed: hasCategory,
    severity: hasCategory ? "INFO" : "WARNING",
    message: hasCategory ? undefined : "建议设置商品分类",
  });
  if (!hasCategory) {
    addIssue(warnings, {
      code: "MISSING_CATEGORY",
      severity: "WARNING",
      message: "建议设置商品分类",
      field: "categoryId",
    });
    score -= 5;
  }

  const hasMainImage = isNonEmpty(product.mainImage ?? "");
  addCheck(checks, {
    key: "mainImage",
    label: "主图",
    passed: hasMainImage,
    severity: hasMainImage ? "INFO" : "BLOCKER",
    message: hasMainImage ? undefined : "缺少商品主图",
  });
  if (!hasMainImage) {
    addIssue(blockingIssues, {
      code: "MISSING_MAIN_IMAGE",
      severity: "BLOCKER",
      message: "缺少商品主图，无法上架",
      field: "mainImage",
    });
    score -= 20;
  }

  const detailImages = product.detailImages ?? [];
  const hasDetailContent =
    detailImages.length > 0 ||
    isNonEmpty(product.description) ||
    isNonEmpty(product.story);
  addCheck(checks, {
    key: "detailContent",
    label: "详情内容",
    passed: hasDetailContent,
    severity: hasDetailContent ? "INFO" : "WARNING",
    message: hasDetailContent ? undefined : "建议补充详情图或详情文案",
  });
  if (!hasDetailContent) {
    addIssue(warnings, {
      code: "MISSING_DETAIL",
      severity: "WARNING",
      message: "建议补充详情图或详情文案",
    });
    score -= 8;
  }

  const hasDescription = isNonEmpty(product.description);
  const hasStory = isNonEmpty(product.story);
  if (!hasDescription && !hasStory) {
    addIssue(warnings, {
      code: "MISSING_DESCRIPTION",
      severity: "WARNING",
      message: "建议补充商品描述或产品故事",
    });
    score -= 5;
  }

  // --- SKU ---
  const enabledSkus = activeSkus(skus);
  const hasSku = skus.length > 0;
  addCheck(checks, {
    key: "hasSku",
    label: "SKU 存在",
    passed: hasSku,
    severity: hasSku ? "INFO" : "BLOCKER",
    message: hasSku ? undefined : "至少需要一个 SKU",
  });
  if (!hasSku) {
    addIssue(blockingIssues, {
      code: "NO_SKU",
      severity: "BLOCKER",
      message: "至少需要一个 SKU",
    });
    score -= 25;
  }

  const hasEnabledSku = enabledSkus.length > 0;
  addCheck(checks, {
    key: "enabledSku",
    label: "启用 SKU",
    passed: hasEnabledSku,
    severity: hasEnabledSku ? "INFO" : "BLOCKER",
    message: hasEnabledSku ? undefined : "至少需要一个启用的 SKU",
  });
  if (!hasEnabledSku) {
    addIssue(blockingIssues, {
      code: "NO_ENABLED_SKU",
      severity: "BLOCKER",
      message: "至少需要一个启用的 SKU",
    });
    score -= 20;
  }

  const pricedSkus = enabledSkus.filter((s) => parsePrice(s.price) > 0);
  const hasValidPrice = pricedSkus.length > 0;
  addCheck(checks, {
    key: "validPrice",
    label: "有效售价",
    passed: hasValidPrice,
    severity: hasValidPrice ? "INFO" : "BLOCKER",
    message: hasValidPrice ? undefined : "启用 SKU 须有有效售价",
  });
  if (!hasValidPrice) {
    addIssue(blockingIssues, {
      code: "NO_VALID_PRICE",
      severity: "BLOCKER",
      message: "启用 SKU 须有有效售价",
    });
    score -= 20;
  }

  const stockOkSkus = enabledSkus.filter(
    (s) => (s.stock ?? 0) > 0 || opts.allowPreOrder
  );
  const hasStock = stockOkSkus.length > 0;
  addCheck(checks, {
    key: "stock",
    label: "库存或可预订",
    passed: hasStock,
    severity: hasStock ? "INFO" : "WARNING",
    message: hasStock ? undefined : "启用 SKU 库存为 0 且未开启预订",
  });
  if (!hasStock) {
    addIssue(warnings, {
      code: "NO_STOCK",
      severity: "WARNING",
      message: "启用 SKU 库存为 0，建议补货或开启预订",
    });
    score -= 5;
  }

  const recipeBoundSkus = enabledSkus.filter((s) => isNonEmpty(s.recipeId ?? ""));
  const allHaveRecipe =
    enabledSkus.length > 0 && recipeBoundSkus.length === enabledSkus.length;
  const recipeSeverity: IssueSeverity = opts.requireRecipeForPublish
    ? "BLOCKER"
    : "WARNING";
  addCheck(checks, {
    key: "recipe",
    label: "配方绑定",
    passed: allHaveRecipe,
    severity: allHaveRecipe ? "INFO" : recipeSeverity,
    message: allHaveRecipe ? undefined : "部分 SKU 未绑定配方",
  });
  if (!allHaveRecipe && enabledSkus.length > 0) {
    const issue: ValidationIssue = {
      code: "MISSING_RECIPE",
      severity: recipeSeverity,
      message: "部分 SKU 未绑定配方，无法准确预估成本",
      field: "recipeId",
    };
    if (recipeSeverity === "BLOCKER") {
      addIssue(blockingIssues, issue);
      score -= 15;
    } else {
      addIssue(warnings, issue);
      score -= 8;
    }
  }

  // --- 毛利与产品决策 ---
  const lowestMargin = lowestStandardMargin(enabledSkus);
  if (lowestMargin != null) {
    if (lowestMargin < 0.3) {
      const severity: IssueSeverity = opts.strictMode ? "BLOCKER" : "WARNING";
      const issue: ValidationIssue = {
        code: "VERY_LOW_MARGIN",
        severity,
        message: `标准毛利率 ${(lowestMargin * 100).toFixed(1)}% 偏低，经营风险较高`,
      };
      if (severity === "BLOCKER") {
        addIssue(blockingIssues, issue);
      } else {
        addIssue(warnings, issue);
      }
      score -= 15;
    } else if (lowestMargin < (opts.targetStandardGrossMargin ?? 0.4)) {
      addIssue(warnings, {
        code: "LOW_MARGIN",
        severity: "WARNING",
        message: `标准毛利率 ${(lowestMargin * 100).toFixed(1)}% 低于目标 ${((opts.targetStandardGrossMargin ?? 0.4) * 100).toFixed(0)}%`,
      });
      score -= 10;
    } else {
      addIssue(suggestions, {
        code: "HEALTHY_MARGIN",
        severity: "INFO",
        message: "毛利预估处于健康区间",
      });
    }
  } else if (enabledSkus.length > 0) {
    addIssue(warnings, {
      code: "NO_MARGIN_DATA",
      severity: "WARNING",
      message: "缺少毛利预估数据，建议绑定配方后查看",
    });
    score -= 5;
  }

  const healthStatus = worstHealthStatus(enabledSkus);
  if (healthStatus === "RISKY" || healthStatus === "LOW_MARGIN") {
    addIssue(warnings, {
      code: "PRODUCT_DECISION_RISK",
      severity: "WARNING",
      message:
        healthStatus === "RISKY"
          ? "产品决策显示经营风险较高"
          : "产品决策显示毛利偏低",
    });
    score -= 12;
  } else if (healthStatus === "INCOMPLETE_DATA") {
    addIssue(warnings, {
      code: "INCOMPLETE_DECISION_DATA",
      severity: "WARNING",
      message: "产品决策数据不完整，结论仅供参考",
    });
    score -= 5;
  } else if (healthStatus === "RECOMMENDED" || healthStatus === "HEALTHY") {
    addIssue(suggestions, {
      code: "HEALTHY_DECISION",
      severity: "INFO",
      message: "产品决策状态良好，适合运营推广",
    });
  }

  if (opts.inHomeMainSlot && (healthStatus === "RISKY" || healthStatus === "LOW_MARGIN")) {
    addIssue(warnings, {
      code: "HOME_MAIN_RISK",
      severity: "WARNING",
      message: "该商品当前经营状态不适合作为首页主推",
    });
    score -= 8;
  }

  // --- 运营标签 ---
  const hasOccasionTags = hasTags(product.occasionTags);
  addCheck(checks, {
    key: "occasionTags",
    label: "场景标签",
    passed: hasOccasionTags,
    severity: hasOccasionTags ? "INFO" : "WARNING",
    message: hasOccasionTags ? undefined : "建议设置适用礼赠场景标签",
  });
  if (!hasOccasionTags) {
    addIssue(warnings, {
      code: "MISSING_OCCASION_TAGS",
      severity: "WARNING",
      message: "缺少场景标签，不利于场景推荐与筛选",
      field: "occasionTags",
    });
    score -= 8;
  }

  const optionalTagFields: Array<{
    key: string;
    field: keyof ValidateProductPublishInput["product"];
    label: string;
  }> = [
    { key: "colorTags", field: "colorTags", label: "色系标签" },
    { key: "styleTags", field: "styleTags", label: "风格标签" },
    { key: "relationshipTags", field: "relationshipTags", label: "关系标签" },
    { key: "budgetTags", field: "budgetTags", label: "预算标签" },
    { key: "positioningTags", field: "positioningTags", label: "定位标签" },
  ];

  for (const { key, field, label } of optionalTagFields) {
    const tags = product[field] as string[] | null | undefined;
    const passed = hasTags(tags);
    addCheck(checks, {
      key,
      label,
      passed,
      severity: passed ? "INFO" : "WARNING",
      message: passed ? undefined : `建议设置${label}`,
    });
    if (!passed) {
      addIssue(warnings, {
        code: `MISSING_${key.toUpperCase()}`,
        severity: "WARNING",
        message: `建议设置${label}，提升运营筛选与展示效果`,
        field: key,
      });
      score -= 3;
    }
  }

  score = Math.max(0, Math.min(100, score));

  const canPublish =
    blockingIssues.filter((i) => i.severity === "BLOCKER").length === 0 &&
    hasEnabledSku &&
    hasValidPrice &&
    hasMainImage;

  const severeMarginWarning = warnings.some(
    (w) => w.code === "VERY_LOW_MARGIN" || w.code === "LOW_MARGIN"
  );
  const riskyDecision =
    healthStatus === "RISKY" ||
    healthStatus === "LOW_MARGIN" ||
    healthStatus === "INCOMPLETE_DATA";

  const canPromote =
    canPublish &&
    !severeMarginWarning &&
    !riskyDecision &&
    hasOccasionTags;

  let overallStatus: PublishReadinessStatus;
  if (!canPublish) {
    overallStatus = "BLOCKED";
  } else if (warnings.length > 0) {
    overallStatus = score >= 70 ? "WARNING" : "INCOMPLETE";
  } else if (score >= 85) {
    overallStatus = "READY";
  } else {
    overallStatus = "INCOMPLETE";
  }

  return {
    overallStatus,
    score,
    canPublish,
    canPromote,
    blockingIssues,
    warnings,
    suggestions,
    checks,
  };
}
