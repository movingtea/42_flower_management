import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decimalToString, money } from "@/services/order-cost-pure";
import {
  calculateMarginFromPrice,
  calculateStandardMaterialLines,
  getMarginLevel,
  suggestPriceByTargetMargin,
  type ProductMarginMaterialLine,
  type SuggestedPrice,
} from "@/services/product-margin-pure";

type Tx = Prisma.TransactionClient | typeof prisma;

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
    wiki: {
      chineseName: string;
      standardUnitCost: Prisma.Decimal | null;
      costUnit: string | null;
    };
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

export type RecipeStandardCostEstimate = {
  recipeId: string;
  recipeName: string;
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  lines: ProductMarginMaterialLine[];
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
  warnings: string[];
};

export type ProductMarginEstimate = {
  productId: string;
  productName: string;
  summary: {
    minGrossMargin: string | null;
    maxGrossMargin: string | null;
    avgGrossMargin: string | null;
    warningCount: number;
  };
  skus: SkuMarginEstimate[];
  warnings: string[];
};

function recipeToStandardCostEstimate(
  recipe: RecipeForMargin
): RecipeStandardCostEstimate {
  const material = calculateStandardMaterialLines(
    recipe.lines.map((line) => ({
      flowerWikiId: line.flowerWikiId,
      flowerName: line.wiki.chineseName,
      quantityNeeded: line.quantityNeeded,
      standardUnitCost: line.wiki.standardUnitCost,
    }))
  );

  const packagingCost = recipe.packagingKit
    ? money(recipe.packagingKit.standardCost)
    : money(0);
  const warnings = [...material.warnings];
  if (!recipe.packagingKit) {
    warnings.push(`配方「${recipe.name}」未绑定包装方案，包装成本按 0 计算`);
  }

  const totalCost = money(material.materialCost.plus(packagingCost));

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    materialCost: decimalToString(material.materialCost),
    packagingCost: decimalToString(packagingCost),
    totalCost: decimalToString(totalCost),
    lines: material.lines,
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

function skuToMarginEstimate(sku: SkuForMargin): SkuMarginEstimate {
  const warnings: string[] = [];
  let recipeEstimate: RecipeStandardCostEstimate | null = null;

  if (!sku.recipeId || !sku.recipe) {
    warnings.push("该 SKU 未绑定配方，无法准确预估成本");
  } else {
    recipeEstimate = recipeToStandardCostEstimate(sku.recipe);
    warnings.push(...recipeEstimate.warnings);
  }

  const materialCost = money(recipeEstimate?.materialCost);
  const packagingCost = money(recipeEstimate?.packagingCost);
  const margin = calculateMarginFromPrice({
    price: sku.price,
    materialCost,
    packagingCost,
  });
  warnings.push(...margin.warnings);

  return {
    skuId: sku.id,
    skuName: sku.specName,
    productId: sku.spu.id,
    productName: sku.spu.name,
    price: decimalToString(sku.price),
    recipeId: sku.recipeId,
    recipeName: recipeEstimate?.recipeName ?? null,
    materialCost: decimalToString(materialCost),
    packagingCost: decimalToString(packagingCost),
    totalCost: decimalToString(margin.totalCost),
    estimatedGrossProfit: decimalToString(margin.estimatedGrossProfit),
    estimatedGrossMargin: decimalToString(margin.estimatedGrossMargin, 4),
    marginLevel: getMarginLevel(margin.estimatedGrossMargin),
    suggestedPrices: suggestPriceByTargetMargin(margin.totalCost),
    lines: recipeEstimate?.lines ?? [],
    packagingLine: recipeEstimate?.packagingLine ?? null,
    warnings,
  };
}

const recipeIncludeForMargin = {
  packagingKit: {
    select: { id: true, name: true, standardCost: true },
  },
  lines: {
    include: {
      wiki: {
        select: {
          chineseName: true,
          standardUnitCost: true,
          costUnit: true,
        },
      },
    },
    orderBy: { quantityNeeded: "desc" },
  },
} as const;

const skuIncludeForMargin = {
  spu: { select: { id: true, name: true } },
  recipe: { include: recipeIncludeForMargin },
} as const;

export async function calculateRecipeStandardCost(
  recipeId: string,
  client: Tx = prisma
): Promise<RecipeStandardCostEstimate> {
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    include: recipeIncludeForMargin,
  });
  if (!recipe) throw new Error("配方不存在");
  return recipeToStandardCostEstimate(recipe);
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
  const margins = input.skus.map((sku) => Number(sku.estimatedGrossMargin));
  const validMargins = margins.filter(Number.isFinite);
  const warningCount = input.skus.reduce(
    (sum, sku) => sum + sku.warnings.length,
    0
  );
  const warnings = input.skus.flatMap((sku) =>
    sku.warnings.map((warning) => `${sku.skuName}：${warning}`)
  );

  const avg =
    validMargins.length > 0
      ? validMargins.reduce((sum, value) => sum + value, 0) /
        validMargins.length
      : null;

  return {
    productId: input.productId,
    productName: input.productName,
    summary: {
      minGrossMargin:
        validMargins.length > 0
          ? decimalToString(Math.min(...validMargins), 4)
          : null,
      maxGrossMargin:
        validMargins.length > 0
          ? decimalToString(Math.max(...validMargins), 4)
          : null,
      avgGrossMargin: avg === null ? null : decimalToString(avg, 4),
      warningCount,
    },
    skus: input.skus,
    warnings,
  };
}

export const productMarginSkuInclude = skuIncludeForMargin;
export const estimateSkuMarginFromRecord = skuToMarginEstimate;
