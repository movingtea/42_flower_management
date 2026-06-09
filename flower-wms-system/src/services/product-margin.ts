import { Prisma } from "@/generated/prisma/client";
import { LossMode } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { decimalToString, money } from "@/services/order-cost-pure";
import {
  buildMarginEstimateSlice,
  calculateMaterialLinesByMode,
  calculateMarginFromPrice,
  getMarginLevel,
  suggestPriceByTargetMargin,
  type MarginCostMode,
  type ProductMarginMaterialLine,
  type ProductMarginMaterialLineDetail,
  type SuggestedPrice,
} from "@/services/product-margin-pure";

type Tx = Prisma.TransactionClient | typeof prisma;

type WikiForMargin = {
  chineseName: string;
  standardUnitCost: Prisma.Decimal | null;
  costUnit: string | null;
  optimisticUsableRate: Prisma.Decimal | null;
  standardUsableRate: Prisma.Decimal | null;
  conservativeUsableRate: Prisma.Decimal | null;
  defaultUsableRate: Prisma.Decimal | null;
  lossMode: LossMode | null;
};

type RecipeForMargin = {
  id: string;
  name: string;
  packagingKit: {
    id: string;
    name: string;
    standardCost: Prisma.Decimal;
  } | null;
  lines: Array<{
    flowerWikiId: string;
    quantityNeeded: number;
    wiki: WikiForMargin;
  }>;
};

type SkuForMargin = {
  id: string;
  specName: string;
  price: Prisma.Decimal;
  recipeId: string | null;
  spu: { id: string; name: string };
  recipe: RecipeForMargin | null;
};

export type MarginEstimateSlice = {
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  estimatedGrossProfit: string;
  estimatedGrossMargin: string;
  lossModelExtraCost: string;
  suggestedPrices: SuggestedPrice[];
  marginLevel: string;
  lines: ProductMarginMaterialLineDetail[];
  warnings: string[];
};

export type RecipeStandardCostEstimate = {
  recipeId: string;
  recipeName: string;
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  lossModelStandardMaterialCost?: string;
  lossModelExtraCost?: string;
  lossModelStandardTotalCost?: string;
  lines: ProductMarginMaterialLine[];
  lossModelLines?: ProductMarginMaterialLineDetail[];
  packagingLine: {
    packagingKitId: string;
    name: string;
    standardCost: string;
  } | null;
  warnings: string[];
};

export type SkuMarginEstimate = {
  skuId: string;
  skuName: string;
  productId: string;
  productName: string;
  price: string;
  recipeId: string | null;
  recipeName: string | null;
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  estimatedGrossProfit: string;
  estimatedGrossMargin: string;
  marginLevel: string;
  suggestedPrices: SuggestedPrice[];
  lines: ProductMarginMaterialLine[];
  packagingLine: RecipeStandardCostEstimate["packagingLine"];
  rawEstimate: MarginEstimateSlice;
  lossModelEstimates: {
    optimistic: MarginEstimateSlice;
    standard: MarginEstimateSlice;
    conservative: MarginEstimateSlice;
  };
  recommendedMode: "STANDARD";
  warnings: string[];
};

export type ProductMarginEstimate = {
  productId: string;
  productName: string;
  summary: {
    minGrossMargin: string | null;
    maxGrossMargin: string | null;
    avgGrossMargin: string | null;
    minLossAdjustedGrossMargin: string | null;
    maxLossAdjustedGrossMargin: string | null;
    warningCount: number;
  };
  skus: SkuMarginEstimate[];
  warnings: string[];
};

function wikiLossProfile(wiki: WikiForMargin) {
  return {
    optimisticUsableRate: wiki.optimisticUsableRate,
    standardUsableRate: wiki.standardUsableRate,
    conservativeUsableRate: wiki.conservativeUsableRate,
    defaultUsableRate: wiki.defaultUsableRate,
    lossMode: wiki.lossMode,
  };
}

function recipeLinesForMargin(recipe: RecipeForMargin) {
  return recipe.lines.map((line) => ({
    flowerWikiId: line.flowerWikiId,
    flowerName: line.wiki.chineseName,
    quantityNeeded: line.quantityNeeded,
    standardUnitCost: line.wiki.standardUnitCost,
    lossProfile: wikiLossProfile(line.wiki),
  }));
}

function recipeToStandardCostEstimate(
  recipe: RecipeForMargin,
  mode: MarginCostMode = "RAW"
): RecipeStandardCostEstimate {
  const rawMaterial = calculateMaterialLinesByMode(
    recipeLinesForMargin(recipe),
    "RAW"
  );
  const standardMaterial = calculateMaterialLinesByMode(
    recipeLinesForMargin(recipe),
    LossMode.STANDARD
  );

  const packagingCost = recipe.packagingKit
    ? money(recipe.packagingKit.standardCost)
    : money(0);
  const warnings = [...rawMaterial.warnings, ...standardMaterial.warnings];
  if (!recipe.packagingKit) {
    warnings.push(`配方「${recipe.name}」未绑定包装方案，包装成本按 0 计算`);
  }

  const totalCost = money(rawMaterial.rawMaterialCost.plus(packagingCost));
  const lossModelStandardTotalCost = money(
    standardMaterial.materialCost.plus(packagingCost)
  );

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    materialCost: decimalToString(rawMaterial.rawMaterialCost),
    packagingCost: decimalToString(packagingCost),
    totalCost: decimalToString(totalCost),
    lossModelStandardMaterialCost: decimalToString(standardMaterial.materialCost),
    lossModelExtraCost: decimalToString(standardMaterial.lossModelExtraCost),
    lossModelStandardTotalCost: decimalToString(lossModelStandardTotalCost),
    lines: rawMaterial.lines,
    lossModelLines: standardMaterial.lines,
    packagingLine: recipe.packagingKit
      ? {
          packagingKitId: recipe.packagingKit.id,
          name: recipe.packagingKit.name,
          standardCost: decimalToString(recipe.packagingKit.standardCost),
        }
      : null,
    warnings,
  };
}

function buildSkuLossEstimates(
  sku: SkuForMargin,
  recipeEstimate: RecipeStandardCostEstimate | null
) {
  const packagingCost = money(recipeEstimate?.packagingCost ?? 0);
  const emptyLines: ProductMarginMaterialLineDetail[] = [];
  const noRecipeWarning = "该 SKU 未绑定配方，无法准确预估成本";

  if (!sku.recipeId || !sku.recipe || !recipeEstimate) {
    const empty = buildMarginEstimateSlice({
      price: sku.price,
      materialCost: 0,
      packagingCost: 0,
      lossModelExtraCost: 0,
      lines: emptyLines,
      warnings: [noRecipeWarning],
    });
    return {
      rawEstimate: empty,
      lossModelEstimates: {
        optimistic: empty,
        standard: empty,
        conservative: empty,
      },
      warnings: [noRecipeWarning],
    };
  }

  const modes = [
    ["optimistic", LossMode.OPTIMISTIC],
    ["standard", LossMode.STANDARD],
    ["conservative", LossMode.CONSERVATIVE],
  ] as const;

  const rawMaterial = calculateMaterialLinesByMode(
    recipeLinesForMargin(sku.recipe),
    "RAW"
  );
  const rawEstimate = buildMarginEstimateSlice({
    price: sku.price,
    materialCost: rawMaterial.rawMaterialCost,
    packagingCost,
    lossModelExtraCost: 0,
    lines: rawMaterial.lines,
    warnings: [...rawMaterial.warnings, ...recipeEstimate.warnings],
  });

  const lossModelEstimates = Object.fromEntries(
    modes.map(([key, mode]) => {
      const material = calculateMaterialLinesByMode(
        recipeLinesForMargin(sku.recipe!),
        mode
      );
      return [
        key,
        buildMarginEstimateSlice({
          price: sku.price,
          materialCost: material.materialCost,
          packagingCost,
          lossModelExtraCost: material.lossModelExtraCost,
          lines: material.lines,
          warnings: [...material.warnings, ...recipeEstimate.warnings],
        }),
      ];
    })
  ) as SkuMarginEstimate["lossModelEstimates"];

  return {
    rawEstimate,
    lossModelEstimates,
    warnings: [
      ...new Set([
        ...rawEstimate.warnings,
        ...lossModelEstimates.optimistic.warnings,
        ...lossModelEstimates.standard.warnings,
        ...lossModelEstimates.conservative.warnings,
      ]),
    ],
  };
}

function skuToMarginEstimate(sku: SkuForMargin): SkuMarginEstimate {
  const recipeEstimate = sku.recipe
    ? recipeToStandardCostEstimate(sku.recipe)
    : null;
  const { rawEstimate, lossModelEstimates, warnings } = buildSkuLossEstimates(
    sku,
    recipeEstimate
  );

  return {
    skuId: sku.id,
    skuName: sku.specName,
    productId: sku.spu.id,
    productName: sku.spu.name,
    price: decimalToString(sku.price),
    recipeId: sku.recipeId,
    recipeName: recipeEstimate?.recipeName ?? null,
    materialCost: rawEstimate.materialCost,
    packagingCost: rawEstimate.packagingCost,
    totalCost: rawEstimate.totalCost,
    estimatedGrossProfit: rawEstimate.estimatedGrossProfit,
    estimatedGrossMargin: rawEstimate.estimatedGrossMargin,
    marginLevel: rawEstimate.marginLevel,
    suggestedPrices: rawEstimate.suggestedPrices,
    lines: rawEstimate.lines,
    packagingLine: recipeEstimate?.packagingLine ?? null,
    rawEstimate,
    lossModelEstimates,
    recommendedMode: "STANDARD",
    warnings,
  };
}

const wikiSelectForMargin = {
  chineseName: true,
  standardUnitCost: true,
  costUnit: true,
  optimisticUsableRate: true,
  standardUsableRate: true,
  conservativeUsableRate: true,
  defaultUsableRate: true,
  lossMode: true,
} as const;

const recipeIncludeForMargin = {
  packagingKit: {
    select: { id: true, name: true, standardCost: true },
  },
  lines: {
    include: {
      wiki: { select: wikiSelectForMargin },
    },
    orderBy: { quantityNeeded: "desc" as const },
  },
} as const;

const skuIncludeForMargin = {
  spu: { select: { id: true, name: true } },
  recipe: { include: recipeIncludeForMargin },
} as const;

export async function calculateRecipeStandardCost(
  recipeId: string,
  mode: MarginCostMode = "RAW",
  client: Tx = prisma
): Promise<RecipeStandardCostEstimate> {
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    include: recipeIncludeForMargin,
  });
  if (!recipe) throw new Error("配方不存在");
  return recipeToStandardCostEstimate(recipe, mode);
}

export async function calculateSkuMarginEstimate(
  skuId: string,
  client: Tx = prisma
): Promise<SkuMarginEstimate> {
  const sku = await client.productSku.findUnique({
    where: { id: skuId },
    include: skuIncludeForMargin,
  });
  if (!sku) throw new Error("SKU 不存在");
  return skuToMarginEstimate(sku);
}

export async function calculateProductMarginEstimate(
  productId: string,
  client: Tx = prisma
): Promise<ProductMarginEstimate> {
  const product = await client.productSpu.findFirst({
    where: { id: productId, isDeleted: false },
    select: {
      id: true,
      name: true,
      skus: {
        include: skuIncludeForMargin,
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!product) throw new Error("商品不存在");

  return buildProductMarginEstimate({
    productId: product.id,
    productName: product.name,
    skus: product.skus.map(skuToMarginEstimate),
  });
}

export function buildProductMarginEstimate(input: {
  productId: string;
  productName: string;
  skus: SkuMarginEstimate[];
}): ProductMarginEstimate {
  const rawMargins = input.skus.map((sku) =>
    Number(sku.rawEstimate.estimatedGrossMargin)
  );
  const standardMargins = input.skus.map((sku) =>
    Number(sku.lossModelEstimates.standard.estimatedGrossMargin)
  );
  const validRawMargins = rawMargins.filter(Number.isFinite);
  const validStandardMargins = standardMargins.filter(Number.isFinite);
  const warningCount = input.skus.reduce(
    (sum, sku) => sum + sku.warnings.length,
    0
  );
  const warnings = input.skus.flatMap((sku) =>
    sku.warnings.map((warning) => `${sku.skuName}：${warning}`)
  );

  const avg =
    validRawMargins.length > 0
      ? validRawMargins.reduce((sum, value) => sum + value, 0) /
        validRawMargins.length
      : null;

  return {
    productId: input.productId,
    productName: input.productName,
    summary: {
      minGrossMargin:
        validRawMargins.length > 0
          ? decimalToString(Math.min(...validRawMargins), 4)
          : null,
      maxGrossMargin:
        validRawMargins.length > 0
          ? decimalToString(Math.max(...validRawMargins), 4)
          : null,
      avgGrossMargin: avg === null ? null : decimalToString(avg, 4),
      minLossAdjustedGrossMargin:
        validStandardMargins.length > 0
          ? decimalToString(Math.min(...validStandardMargins), 4)
          : null,
      maxLossAdjustedGrossMargin:
        validStandardMargins.length > 0
          ? decimalToString(Math.max(...validStandardMargins), 4)
          : null,
      warningCount,
    },
    skus: input.skus,
    warnings,
  };
}

export const productMarginSkuInclude = skuIncludeForMargin;
export const estimateSkuMarginFromRecord = skuToMarginEstimate;
