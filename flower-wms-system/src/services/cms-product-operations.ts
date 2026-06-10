import { Prisma } from "@/generated/prisma/client";
import {
  GiftOccasionType,
  RecommendationSlotType,
} from "@/generated/prisma/enums";
import {
  buildWechatOperationTags,
  jsonToTagKeys,
  parseCmsProductTagKeys,
  parseSellingPoints,
  toTagDisplayList,
} from "@/lib/cms-product-tags";
import { activeSpuWhere } from "@/lib/product-query";
import {
  resolveSpuBannerImages,
  resolveSpuCardImageUrl,
  resolveSpuMinPrice,
  productSpuInclude,
} from "@/lib/product-spu";
import { prisma } from "@/lib/prisma";
import {
  evaluateProductHealth,
  PRODUCT_HEALTH_STATUS_LABELS,
  calculateLossSensitivity,
  type ProductHealthStatus,
} from "@/services/product-decision-pure";
import {
  estimateSkuMarginFromRecord,
  productMarginSkuInclude,
  type SkuMarginEstimate,
} from "@/services/product-margin";
import {
  validateProductPublishReadiness,
  type PublishReadinessResult,
  type ValidateProductPublishInput,
} from "@/services/cms-product-validation-pure";

const DEFAULT_PAGE_SIZE = 20;

export type ProductOperationTags = {
  occasionTags: string[];
  colorTags: string[];
  styleTags: string[];
  relationshipTags: string[];
  budgetTags: string[];
  positioningTags: string[];
  sellingPoints: string[];
  operationNote: string | null;
};

export type ProductDecisionSummary = {
  healthStatus: ProductHealthStatus | null;
  healthStatusLabel: string | null;
  keyTags: string[];
  standardGrossMargin: number | null;
  conservativeGrossMargin: number | null;
  suggestedPrice: string | null;
  warnings: string[];
};

export type MarginSummary = {
  minStandardGrossMargin: number | null;
  maxStandardGrossMargin: number | null;
  skuCount: number;
  warningCount: number;
};

export type RecommendationSlotBrief = {
  id: string;
  key: string;
  name: string;
  slotType: RecommendationSlotType;
  itemCount: number;
};

export type ProductOperationProfile = {
  product: {
    id: string;
    name: string;
    isActive: boolean;
    categoryIds: string[];
    mainImage: string;
    detailImages: string[];
    description: string | null;
    story: string | null;
  };
  tags: ProductOperationTags;
  skus: Array<{
    id: string;
    specName: string;
    price: string;
    stock: number;
    recipeId: string | null;
    marginEstimate: SkuMarginEstimate | null;
    productDecision: ProductDecisionSummary | null;
  }>;
  marginSummary: MarginSummary;
  productDecisionSummary: ProductDecisionSummary;
  publishReadiness: PublishReadinessResult;
  recommendationSlots: RecommendationSlotBrief[];
};

function extractTagsFromSpu(spu: {
  occasionTags: string[];
  colorTags: unknown;
  styleTags: unknown;
  relationshipTags: unknown;
  budgetTags: unknown;
  positioningTags: unknown;
  sellingPoints: unknown;
  operationNote: string | null;
}): ProductOperationTags {
  return {
    occasionTags: spu.occasionTags ?? [],
    colorTags: jsonToTagKeys(spu.colorTags),
    styleTags: jsonToTagKeys(spu.styleTags),
    relationshipTags: jsonToTagKeys(spu.relationshipTags),
    budgetTags: jsonToTagKeys(spu.budgetTags),
    positioningTags: jsonToTagKeys(spu.positioningTags),
    sellingPoints: jsonToTagKeys(spu.sellingPoints),
    operationNote: spu.operationNote,
  };
}

function parseMarginRatio(value: string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSkuDecisionSummary(
  sku: {
    price: Prisma.Decimal;
    recipeId: string | null;
  },
  margin: SkuMarginEstimate | null
): ProductDecisionSummary {
  const standardMargin = parseMarginRatio(
    margin?.lossModelEstimates?.standard?.estimatedGrossMargin ??
      margin?.estimatedGrossMargin
  );
  const conservativeMargin = parseMarginRatio(
    margin?.lossModelEstimates?.conservative?.estimatedGrossMargin
  );

  const hasRecipe = Boolean(sku.recipeId);
  const hasCompleteCostData = Boolean(
    margin &&
      Number(margin.totalCost) > 0 &&
      !margin.warnings.some((w) => w.includes("未绑定配方"))
  );

  const lossSensitivity = calculateLossSensitivity({
    optimisticGrossMargin: parseMarginRatio(
      margin?.lossModelEstimates?.optimistic?.estimatedGrossMargin
    ),
    standardGrossMargin: standardMargin,
    conservativeGrossMargin: conservativeMargin,
  });

  const health = evaluateProductHealth({
    salesAmount: 0,
    orderCount: 0,
    standardGrossMargin: standardMargin,
    conservativeGrossMargin: conservativeMargin,
    lossSensitivityLevel: lossSensitivity.sensitivityLevel,
    hasRecipe,
    hasCompleteCostData,
    isActive: true,
    productPrice: Number(sku.price),
    standardTotalCost: Number(margin?.totalCost ?? 0),
    conservativeTotalCost: Number(
      margin?.lossModelEstimates?.conservative?.totalCost ?? margin?.totalCost ?? 0
    ),
    packagingCostRatio: margin
      ? Number(margin.packagingCost) /
        Math.max(Number(margin.totalCost), 0.01)
      : null,
  });

  const suggestedPrice = margin?.suggestedPrices?.[0]?.price ?? null;

  return {
    healthStatus: health.healthStatus,
    healthStatusLabel: PRODUCT_HEALTH_STATUS_LABELS[health.healthStatus],
    keyTags: health.tags.map((t) => t.key),
    standardGrossMargin: standardMargin,
    conservativeGrossMargin: conservativeMargin,
    suggestedPrice,
    warnings: [...health.warnings, ...lossSensitivity.warnings],
  };
}

function aggregateDecisionSummary(
  summaries: ProductDecisionSummary[]
): ProductDecisionSummary {
  if (summaries.length === 0) {
    return {
      healthStatus: null,
      healthStatusLabel: null,
      keyTags: [],
      standardGrossMargin: null,
      conservativeGrossMargin: null,
      suggestedPrice: null,
      warnings: [],
    };
  }

  const priority: ProductHealthStatus[] = [
    "RISKY",
    "LOW_MARGIN",
    "INCOMPLETE_DATA",
    "IMAGE_ONLY",
    "OBSERVE",
    "HEALTHY",
    "RECOMMENDED",
  ];

  let worst: ProductHealthStatus | null = null;
  for (const status of priority) {
    if (summaries.some((s) => s.healthStatus === status)) {
      worst = status;
      break;
    }
  }

  const margins = summaries
    .map((s) => s.standardGrossMargin)
    .filter((m): m is number => m != null);
  const conservativeMargins = summaries
    .map((s) => s.conservativeGrossMargin)
    .filter((m): m is number => m != null);

  const allTags = [...new Set(summaries.flatMap((s) => s.keyTags))];
  const allWarnings = [...new Set(summaries.flatMap((s) => s.warnings))];

  return {
    healthStatus: worst,
    healthStatusLabel: worst ? PRODUCT_HEALTH_STATUS_LABELS[worst] : null,
    keyTags: allTags,
    standardGrossMargin: margins.length ? Math.min(...margins) : null,
    conservativeGrossMargin: conservativeMargins.length
      ? Math.min(...conservativeMargins)
      : null,
    suggestedPrice: summaries.find((s) => s.suggestedPrice)?.suggestedPrice ?? null,
    warnings: allWarnings,
  };
}

function buildValidationInput(
  spu: {
    id: string;
    name: string;
    isActive: boolean;
    description: string | null;
    maintenanceGuide: string | null;
    allowPreOrder: boolean;
    occasionTags: string[];
    colorTags: unknown;
    styleTags: unknown;
    relationshipTags: unknown;
    budgetTags: unknown;
    positioningTags: unknown;
    categories: { productCategoryId: string }[];
    skus: Array<{
      id: string;
      skuCode?: string;
      specName: string;
      price: Prisma.Decimal;
      stock: number;
      recipeId: string | null;
      imageUrl: string | null;
      isMainImage: boolean;
    }>;
  },
  skuDecisions: Array<{
    sku: (typeof spu)["skus"][number];
    margin: SkuMarginEstimate | null;
    decision: ProductDecisionSummary;
  }>,
  options?: ValidateProductPublishInput["options"]
): ValidateProductPublishInput {
  const mainImage = resolveSpuCardImageUrl(
    spu.skus.map((s) => ({
      id: s.id,
      skuCode: s.skuCode ?? s.id,
      specName: s.specName,
      price: s.price,
      stock: s.stock,
      imageUrl: s.imageUrl,
      isMainImage: s.isMainImage,
    }))
  );
  const detailImages = resolveSpuBannerImages(
    spu.skus.map((s) => ({
      id: s.id,
      skuCode: s.skuCode ?? s.id,
      specName: s.specName,
      price: s.price,
      stock: s.stock,
      imageUrl: s.imageUrl,
      isMainImage: s.isMainImage,
    }))
  );
  const categoryId = spu.categories[0]?.productCategoryId ?? null;

  return {
    product: {
      id: spu.id,
      name: spu.name,
      status: spu.isActive,
      categoryId,
      mainImage,
      detailImages,
      description: spu.description,
      story: spu.maintenanceGuide,
      occasionTags: spu.occasionTags,
      colorTags: jsonToTagKeys(spu.colorTags),
      styleTags: jsonToTagKeys(spu.styleTags),
      relationshipTags: jsonToTagKeys(spu.relationshipTags),
      budgetTags: jsonToTagKeys(spu.budgetTags),
      positioningTags: jsonToTagKeys(spu.positioningTags),
    },
    skus: skuDecisions.map(({ sku, decision }) => ({
      id: sku.id,
      name: sku.specName,
      price: Number(sku.price),
      isActive: true,
      stock: sku.stock,
      recipeId: sku.recipeId,
      marginEstimate: {
        standardGrossMargin: decision.standardGrossMargin,
        conservativeGrossMargin: decision.conservativeGrossMargin,
      },
      productDecision: {
        healthStatus: decision.healthStatus,
        keyTags: decision.keyTags,
      },
    })),
    options: {
      allowPreOrder: spu.allowPreOrder,
      ...options,
    },
  };
}

async function loadSpuForOperations(productId: string) {
  const spu = await prisma.productSpu.findFirst({
    where: { id: productId, ...activeSpuWhere },
    include: {
      ...productSpuInclude,
      categories: { select: { productCategoryId: true } },
    },
  });
  if (!spu) throw new Error("商品不存在");
  return spu;
}

async function loadSkuMargins(spu: { skus: Array<{ id: string }> }) {
  const skusWithRecipe = await prisma.productSku.findMany({
    where: { id: { in: spu.skus.map((s) => s.id) } },
    include: productMarginSkuInclude,
  });
  const marginBySkuId = new Map(
    skusWithRecipe.map((sku) => [sku.id, estimateSkuMarginFromRecord(sku)])
  );
  return marginBySkuId;
}

export async function getProductOperationProfile(
  productId: string
): Promise<ProductOperationProfile> {
  const spu = await loadSpuForOperations(productId);
  const marginBySkuId = await loadSkuMargins(spu);

  const skuRows = spu.skus.map((sku) => {
    const margin = marginBySkuId.get(sku.id) ?? null;
    const decision = buildSkuDecisionSummary(sku, margin);
    return { sku, margin, decision };
  });

  const productDecisionSummary = aggregateDecisionSummary(
    skuRows.map((r) => r.decision)
  );

  const margins = skuRows
    .map((r) => r.decision.standardGrossMargin)
    .filter((m): m is number => m != null);

  const marginSummary: MarginSummary = {
    minStandardGrossMargin: margins.length ? Math.min(...margins) : null,
    maxStandardGrossMargin: margins.length ? Math.max(...margins) : null,
    skuCount: spu.skus.length,
    warningCount: skuRows.reduce(
      (n, r) => n + (r.margin?.warnings.length ?? 0),
      0
    ),
  };

  const recommendationSlots = await prisma.cmsRecommendationSlot.findMany({
    where: {
      isActive: true,
      items: { some: { productId, isActive: true } },
    },
    select: {
      id: true,
      key: true,
      name: true,
      slotType: true,
      _count: { select: { items: true } },
    },
  });

  const publishReadiness = validateProductPublishReadiness(
    buildValidationInput(spu, skuRows)
  );

  return {
    product: {
      id: spu.id,
      name: spu.name,
      isActive: spu.isActive,
      categoryIds: spu.categories.map((c) => c.productCategoryId),
      mainImage: resolveSpuCardImageUrl(spu.skus),
      detailImages: resolveSpuBannerImages(spu.skus),
      description: spu.description,
      story: spu.maintenanceGuide,
    },
    tags: extractTagsFromSpu(spu),
    skus: skuRows.map(({ sku, margin, decision }) => ({
      id: sku.id,
      specName: sku.specName,
      price: sku.price.toString(),
      stock: sku.stock,
      recipeId: sku.recipeId,
      marginEstimate: margin,
      productDecision: decision,
    })),
    marginSummary,
    productDecisionSummary,
    publishReadiness,
    recommendationSlots: recommendationSlots.map((slot) => ({
      id: slot.id,
      key: slot.key,
      name: slot.name,
      slotType: slot.slotType,
      itemCount: slot._count.items,
    })),
  };
}

export async function validateProductForPublish(
  productId: string,
  options?: ValidateProductPublishInput["options"]
): Promise<PublishReadinessResult> {
  const spu = await loadSpuForOperations(productId);
  const marginBySkuId = await loadSkuMargins(spu);
  const skuRows = spu.skus.map((sku) => {
    const margin = marginBySkuId.get(sku.id) ?? null;
    const decision = buildSkuDecisionSummary(sku, margin);
    return { sku, margin, decision };
  });
  return validateProductPublishReadiness(
    buildValidationInput(spu, skuRows, options)
  );
}

export type ListProductOperationSummariesParams = {
  keyword?: string | null;
  categoryId?: string | null;
  status?: "active" | "inactive" | null;
  occasionTag?: string | null;
  positioningTag?: string | null;
  readinessStatus?: PublishReadinessResult["overallStatus"] | null;
  page?: number | string | null;
  pageSize?: number | string | null;
};

export type ProductOperationSummaryItem = {
  id: string;
  name: string;
  isActive: boolean;
  mainImage: string;
  minPrice: string;
  tags: Pick<
    ProductOperationTags,
    "occasionTags" | "positioningTags" | "colorTags"
  >;
  publishReadiness: Pick<
    PublishReadinessResult,
    "overallStatus" | "score" | "canPublish" | "canPromote"
  >;
  productDecisionSummary: Pick<
    ProductDecisionSummary,
    "healthStatus" | "healthStatusLabel" | "standardGrossMargin"
  >;
  hasRecommendationSlot: boolean;
};

export async function listProductOperationSummaries(
  params: ListProductOperationSummariesParams = {}
): Promise<{
  items: ProductOperationSummaryItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(params.pageSize) || DEFAULT_PAGE_SIZE)
  );

  const where: Prisma.ProductSpuWhereInput = {
    ...activeSpuWhere,
  };

  if (params.status === "active") where.isActive = true;
  else if (params.status === "inactive") where.isActive = false;

  if (params.categoryId) {
    where.categories = { some: { productCategoryId: params.categoryId } };
  }

  if (params.occasionTag) {
    where.occasionTags = { has: params.occasionTag };
  }

  if (params.positioningTag) {
    where.positioningTags = {
      array_contains: params.positioningTag,
    };
  }

  if (params.keyword?.trim()) {
    const kw = params.keyword.trim();
    where.OR = [
      { name: { contains: kw, mode: "insensitive" } },
      { description: { contains: kw, mode: "insensitive" } },
    ];
  }

  const [total, spus] = await Promise.all([
    prisma.productSpu.count({ where }),
    prisma.productSpu.findMany({
      where,
      include: productSpuInclude,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const productIds = spus.map((s) => s.id);
  const recCounts = await prisma.cmsRecommendationItem.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, isActive: true },
    _count: { productId: true },
  });
  const recSet = new Set(recCounts.map((r) => r.productId));

  let items: ProductOperationSummaryItem[] = spus.map((spu) => {
    const mainImage = resolveSpuCardImageUrl(spu.skus);
    const minPrice = resolveSpuMinPrice(spu.skus);

    const publishReadiness = validateProductPublishReadiness(
      buildValidationInput(
        {
          ...spu,
          categories: spu.categories.map((c) => ({
            productCategoryId: c.productCategoryId,
          })),
        },
        spu.skus.map((sku) => ({
          sku,
          margin: null,
          decision: {
            healthStatus: null,
            healthStatusLabel: null,
            keyTags: [],
            standardGrossMargin: null,
            conservativeGrossMargin: null,
            suggestedPrice: null,
            warnings: [],
          },
        }))
      )
    );

    return {
      id: spu.id,
      name: spu.name,
      isActive: spu.isActive,
      mainImage,
      minPrice: minPrice.toFixed(2),
      tags: {
        occasionTags: spu.occasionTags ?? [],
        positioningTags: jsonToTagKeys(spu.positioningTags),
        colorTags: jsonToTagKeys(spu.colorTags),
      },
      publishReadiness: {
        overallStatus: publishReadiness.overallStatus,
        score: publishReadiness.score,
        canPublish: publishReadiness.canPublish,
        canPromote: publishReadiness.canPromote,
      },
      productDecisionSummary: {
        healthStatus: null,
        healthStatusLabel: null,
        standardGrossMargin: null,
      },
      hasRecommendationSlot: recSet.has(spu.id),
    };
  });

  if (params.readinessStatus) {
    items = items.filter(
      (item) => item.publishReadiness.overallStatus === params.readinessStatus
    );
  }

  return { items, total, page, pageSize };
}

// --- Recommendation slot CRUD ---

export type CreateRecommendationSlotInput = {
  key: string;
  name: string;
  description?: string | null;
  slotType: RecommendationSlotType;
  sceneType?: GiftOccasionType | null;
  isActive?: boolean;
  sortOrder?: number;
  maxItems?: number;
};

export async function createRecommendationSlot(
  input: CreateRecommendationSlotInput
) {
  const key = input.key.trim();
  if (!key) throw new Error("推荐位 key 不能为空");

  return prisma.cmsRecommendationSlot.create({
    data: {
      key,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      slotType: input.slotType,
      sceneType: input.sceneType ?? null,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      maxItems: input.maxItems ?? 10,
    },
  });
}

export type UpdateRecommendationSlotInput = Partial<CreateRecommendationSlotInput>;

export async function updateRecommendationSlot(
  id: string,
  input: UpdateRecommendationSlotInput
) {
  const data: Prisma.CmsRecommendationSlotUpdateInput = {};
  if (input.key !== undefined) data.key = input.key.trim();
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.slotType !== undefined) data.slotType = input.slotType;
  if (input.sceneType !== undefined) data.sceneType = input.sceneType;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.maxItems !== undefined) data.maxItems = input.maxItems;

  return prisma.cmsRecommendationSlot.update({ where: { id }, data });
}

export async function listRecommendationSlots(params?: {
  isActive?: boolean | null;
  slotType?: RecommendationSlotType | null;
}) {
  return prisma.cmsRecommendationSlot.findMany({
    where: {
      ...(params?.isActive != null ? { isActive: params.isActive } : {}),
      ...(params?.slotType ? { slotType: params.slotType } : {}),
    },
    include: {
      _count: { select: { items: true } },
      items: {
        where: { isActive: true },
        take: 3,
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          productId: true,
          sortOrder: true,
          product: { select: { name: true, isActive: true } },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getRecommendationSlotDetail(id: string) {
  const slot = await prisma.cmsRecommendationSlot.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          product: {
            select: {
              id: true,
              name: true,
              isActive: true,
              occasionTags: true,
            },
          },
          sku: {
            select: { id: true, specName: true, price: true },
          },
        },
      },
    },
  });
  if (!slot) throw new Error("推荐位不存在");
  return slot;
}

export async function deleteRecommendationSlot(id: string) {
  return prisma.cmsRecommendationSlot.update({
    where: { id },
    data: { isActive: false },
  });
}

export type AddRecommendationItemInput = {
  productId: string;
  skuId?: string | null;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  imageOverride?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  note?: string | null;
};

function parseOptionalDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function addRecommendationItem(
  slotId: string,
  input: AddRecommendationItemInput
): Promise<{
  item: Awaited<ReturnType<typeof prisma.cmsRecommendationItem.create>>;
  warnings: string[];
  publishReadiness: PublishReadinessResult;
}> {
  const slot = await prisma.cmsRecommendationSlot.findUnique({
    where: { id: slotId },
  });
  if (!slot) throw new Error("推荐位不存在");

  const product = await prisma.productSpu.findFirst({
    where: { id: input.productId, ...activeSpuWhere },
    include: productSpuInclude,
  });
  if (!product) throw new Error("商品不存在");

  if (input.skuId) {
    const sku = product.skus.find((s) => s.id === input.skuId);
    if (!sku) throw new Error("SKU 不属于该商品");
  }

  const warnings: string[] = [];
  const publishReadiness = await validateProductForPublish(product.id);

  if (!publishReadiness.canPublish) {
    warnings.push("该商品上架校验未通过，仍允许配置但小程序不会展示未上架商品");
  }

  if (!product.occasionTags?.length) {
    warnings.push("该商品缺少场景标签，可能不适合场景推荐位");
  }

  if (
    slot.sceneType &&
    !product.occasionTags.includes(slot.sceneType)
  ) {
    warnings.push("该商品未标记为当前场景，建议确认是否适合该推荐位");
  }

  const profile = await getProductOperationProfile(product.id);
  const health = profile.productDecisionSummary.healthStatus;
  if (health === "LOW_MARGIN") {
    warnings.push("该商品毛利偏低，不建议作为主推");
  }
  if (health === "RISKY") {
    warnings.push("该商品经营风险较高，不建议作为首页主推");
  }

  const missingRecipe = product.skus.some((s) => !s.recipeId);
  if (missingRecipe) {
    warnings.push("该商品缺少配方，无法判断成本和毛利");
  }

  if (
    slot.slotType === "HOME_MAIN" &&
    (health === "RISKY" || health === "LOW_MARGIN")
  ) {
    warnings.push("该商品当前经营状态不适合作为首页主推");
  }

  const item = await prisma.cmsRecommendationItem.create({
    data: {
      slotId,
      productId: input.productId,
      skuId: input.skuId ?? null,
      titleOverride: input.titleOverride?.trim() || null,
      subtitleOverride: input.subtitleOverride?.trim() || null,
      imageOverride: input.imageOverride?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      startAt: parseOptionalDate(input.startAt),
      endAt: parseOptionalDate(input.endAt),
      note: input.note?.trim() || null,
    },
  });

  return {
    item,
    warnings,
    publishReadiness: {
      overallStatus: publishReadiness.overallStatus,
      score: publishReadiness.score,
      canPublish: publishReadiness.canPublish,
      canPromote: publishReadiness.canPromote,
      blockingIssues: publishReadiness.blockingIssues,
      warnings: publishReadiness.warnings,
      suggestions: publishReadiness.suggestions,
      checks: publishReadiness.checks,
    },
  };
}

export type UpdateRecommendationItemInput = Partial<AddRecommendationItemInput>;

export async function updateRecommendationItem(
  id: string,
  input: UpdateRecommendationItemInput
) {
  const existing = await prisma.cmsRecommendationItem.findUnique({
    where: { id },
  });
  if (!existing) throw new Error("推荐项不存在");

  if (input.skuId && input.productId) {
    const product = await prisma.productSpu.findFirst({
      where: { id: input.productId, ...activeSpuWhere },
      include: { skus: { select: { id: true } } },
    });
    if (!product) throw new Error("商品不存在");
    if (!product.skus.some((s) => s.id === input.skuId)) {
      throw new Error("SKU 不属于该商品");
    }
  }

  return prisma.cmsRecommendationItem.update({
    where: { id },
    data: {
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.skuId !== undefined ? { skuId: input.skuId } : {}),
      ...(input.titleOverride !== undefined
        ? { titleOverride: input.titleOverride?.trim() || null }
        : {}),
      ...(input.subtitleOverride !== undefined
        ? { subtitleOverride: input.subtitleOverride?.trim() || null }
        : {}),
      ...(input.imageOverride !== undefined
        ? { imageOverride: input.imageOverride?.trim() || null }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.startAt !== undefined
        ? { startAt: parseOptionalDate(input.startAt) }
        : {}),
      ...(input.endAt !== undefined
        ? { endAt: parseOptionalDate(input.endAt) }
        : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
    },
  });
}

export async function removeRecommendationItem(id: string) {
  return prisma.cmsRecommendationItem.update({
    where: { id },
    data: { isActive: false },
  });
}

export type ListActiveRecommendationsParams = {
  slotKey?: string | null;
  sceneType?: GiftOccasionType | string | null;
  now?: Date;
  limit?: number | string | null;
};

export type MiniprogramRecommendationItem = {
  productId: string;
  skuId: string | null;
  productName: string;
  skuName: string | null;
  price: string;
  coverImage: string;
  subtitle: string | null;
  occasionTags: ReturnType<typeof toTagDisplayList>;
  colorTags: ReturnType<typeof toTagDisplayList>;
  styleTags: ReturnType<typeof toTagDisplayList>;
  sellingPoints: string[];
};

export type MiniprogramRecommendationSlot = {
  key: string;
  name: string;
  slotType: RecommendationSlotType;
  sceneType: GiftOccasionType | null;
  items: MiniprogramRecommendationItem[];
};

export async function listActiveRecommendationsForMiniProgram(
  params: ListActiveRecommendationsParams = {}
): Promise<{ slots: MiniprogramRecommendationSlot[] }> {
  const now = params.now ?? new Date();
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 10));

  const slotWhere: Prisma.CmsRecommendationSlotWhereInput = {
    isActive: true,
    ...(params.slotKey ? { key: params.slotKey } : {}),
    ...(params.sceneType
      ? { sceneType: params.sceneType as GiftOccasionType }
      : {}),
  };

  const slots = await prisma.cmsRecommendationSlot.findMany({
    where: slotWhere,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      items: {
        where: {
          isActive: true,
          OR: [{ startAt: null }, { startAt: { lte: now } }],
          AND: [
            { OR: [{ endAt: null }, { endAt: { gte: now } }] },
            {
              product: {
                isActive: true,
                isDeleted: false,
              },
            },
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: limit,
        include: {
          product: {
            include: productSpuInclude,
          },
          sku: true,
        },
      },
    },
  });

  const result: MiniprogramRecommendationSlot[] = [];

  for (const slot of slots) {
    const items: MiniprogramRecommendationItem[] = [];

    for (const item of slot.items) {
      const product = item.product;
      if (!product.isActive) continue;

      const sku = item.skuId
        ? product.skus.find((s) => s.id === item.skuId)
        : product.skus.find((s) => s.isMainImage) ?? product.skus[0];

      if (!sku) continue;

      const price = sku.price.toString();
      const coverImage =
        item.imageOverride?.trim() ||
        sku.imageUrl?.trim() ||
        resolveSpuCardImageUrl(product.skus);

      const opTags = buildWechatOperationTags(product);

      items.push({
        productId: product.id,
        skuId: item.skuId ?? sku.id,
        productName: item.titleOverride?.trim() || product.name,
        skuName: sku.specName,
        price,
        coverImage,
        subtitle: item.subtitleOverride?.trim() || product.description,
        occasionTags: opTags.occasionTags,
        colorTags: opTags.colorTags,
        styleTags: opTags.styleTags,
        sellingPoints: opTags.sellingPoints,
      });
    }

    if (items.length > 0 || params.slotKey) {
      result.push({
        key: slot.key,
        name: slot.name,
        slotType: slot.slotType,
        sceneType: slot.sceneType,
        items,
      });
    }
  }

  return { slots: result };
}

export function parseOperationTagsFromBody(raw: Record<string, unknown>): {
  occasionTags?: string[];
  colorTags?: string[];
  styleTags?: string[];
  relationshipTags?: string[];
  budgetTags?: string[];
  positioningTags?: string[];
  sellingPoints?: string[];
  operationNote?: string | null;
} {
  const result: ReturnType<typeof parseOperationTagsFromBody> = {};

  if (raw.occasionTags !== undefined) {
    result.occasionTags = parseCmsProductTagKeys("occasion", raw.occasionTags);
  }
  if (raw.colorTags !== undefined) {
    result.colorTags = parseCmsProductTagKeys("color", raw.colorTags);
  }
  if (raw.styleTags !== undefined) {
    result.styleTags = parseCmsProductTagKeys("style", raw.styleTags);
  }
  if (raw.relationshipTags !== undefined) {
    result.relationshipTags = parseCmsProductTagKeys(
      "relationship",
      raw.relationshipTags
    );
  }
  if (raw.budgetTags !== undefined) {
    result.budgetTags = parseCmsProductTagKeys("budget", raw.budgetTags);
  }
  if (raw.positioningTags !== undefined) {
    result.positioningTags = parseCmsProductTagKeys(
      "positioning",
      raw.positioningTags
    );
  }
  if (raw.sellingPoints !== undefined) {
    result.sellingPoints = parseSellingPoints(raw.sellingPoints);
  }
  if (raw.operationNote !== undefined) {
    result.operationNote =
      typeof raw.operationNote === "string"
        ? raw.operationNote.trim() || null
        : null;
  }

  return result;
}

export function operationTagsToPrismaData(
  tags: ReturnType<typeof parseOperationTagsFromBody>
): Prisma.ProductSpuUncheckedUpdateInput {
  const data: Prisma.ProductSpuUncheckedUpdateInput = {};
  if (tags.occasionTags !== undefined) data.occasionTags = tags.occasionTags;
  if (tags.colorTags !== undefined) data.colorTags = tags.colorTags;
  if (tags.styleTags !== undefined) data.styleTags = tags.styleTags;
  if (tags.relationshipTags !== undefined) {
    data.relationshipTags = tags.relationshipTags;
  }
  if (tags.budgetTags !== undefined) data.budgetTags = tags.budgetTags;
  if (tags.positioningTags !== undefined) {
    data.positioningTags = tags.positioningTags;
  }
  if (tags.sellingPoints !== undefined) data.sellingPoints = tags.sellingPoints;
  if (tags.operationNote !== undefined) data.operationNote = tags.operationNote;
  return data;
}
