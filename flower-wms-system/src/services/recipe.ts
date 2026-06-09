import { Prisma } from "@/generated/prisma/client";
import { formatIngredientSummary } from "../lib/recipe-display";
import { prisma } from "@/lib/prisma";
import { decimalToString, money } from "@/services/order-cost-pure";
import {
  calculateStandardMaterialLines,
  type ProductMarginMaterialLine,
} from "@/services/product-margin-pure";

export type RecipeIngredientInput = {
  flowerWikiId: string;
  quantity: number;
};

export type RecipeIngredientRow = {
  id: string;
  flowerWikiId: string;
  quantity: number;
  chineseName: string;
  englishName: string;
  colorTags: string[];
};

export type RecipeSummary = {
  id: string;
  recipeCode: string;
  name: string;
  description: string | null;
  packagingKitId: string | null;
  packagingKit: {
    id: string;
    name: string;
    standardCost: string;
  } | null;
  productCount: number;
  ingredients: RecipeIngredientRow[];
  standardCost: RecipeCostPreview;
  createdAt: string;
  updatedAt: string;
};

export type RecipeListItem = {
  id: string;
  recipeCode: string;
  name: string;
  ingredientSummary: string;
  packagingKitName: string | null;
  packagingKitStandardCost: string | null;
  standardMaterialCost: string;
  standardPackagingCost: string;
  standardTotalCost: string;
  missingStandardCostCount: number;
  productCount: number;
  ingredientCount: number;
};

export type RecipeCostPreview = {
  materialCost: string;
  packagingCost: string;
  totalCost: string;
  missingStandardCostCount: number;
  isComplete: boolean;
  lines: ProductMarginMaterialLine[];
  warnings: string[];
};

type Tx = Prisma.TransactionClient;

/** 配方明细只关联 FlowerWiki，不触碰 materials / batches */
const lineInclude = {
  wiki: {
    select: {
      id: true,
      chineseName: true,
      englishName: true,
      colorTags: true,
      standardUnitCost: true,
      costUnit: true,
    },
  },
} as const;

function mapRecipeLines(
  rows: Array<{
    id: string;
    quantityNeeded: number;
    flowerWikiId: string;
    wiki: {
      id: string;
      chineseName: string;
      englishName: string;
      colorTags: string[];
      standardUnitCost?: Prisma.Decimal | null;
      costUnit?: string | null;
    };
  }>
): RecipeIngredientRow[] {
  return rows.map((row) => ({
    id: row.id,
    flowerWikiId: row.wiki.id,
    quantity: row.quantityNeeded,
    chineseName: row.wiki.chineseName,
    englishName: row.wiki.englishName,
    colorTags: row.wiki.colorTags,
  }));
}

function serializeRecipe(
  recipe: {
    id: string;
    recipeCode: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<{
      id: string;
      quantityNeeded: number;
      flowerWikiId: string;
      wiki: {
        id: string;
        chineseName: string;
        englishName: string;
        colorTags: string[];
      };
    }>;
    packagingKit: {
      id: string;
      name: string;
      standardCost: Prisma.Decimal;
    } | null;
    _count: { skus: number };
  }
): RecipeSummary {
  const ingredients = mapRecipeLines(recipe.lines);
  const standardCost = buildRecipeCostPreview(recipe);

  return {
    id: recipe.id,
    recipeCode: recipe.recipeCode,
    name: recipe.name,
    description: recipe.description,
    packagingKitId: recipe.packagingKit?.id ?? null,
    packagingKit: recipe.packagingKit
      ? {
          id: recipe.packagingKit.id,
          name: recipe.packagingKit.name,
          standardCost: recipe.packagingKit.standardCost.toFixed(2),
        }
      : null,
    productCount: recipe._count.skus,
    ingredients,
    standardCost,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function buildRecipeCostPreview(recipe: {
  name: string;
  lines: Array<{
    flowerWikiId: string;
    quantityNeeded: number;
    wiki: {
      chineseName: string;
      standardUnitCost?: Prisma.Decimal | null;
    };
  }>;
  packagingKit: { standardCost: Prisma.Decimal } | null;
}): RecipeCostPreview {
  const material = calculateStandardMaterialLines(
    recipe.lines.map((line) => ({
      flowerWikiId: line.flowerWikiId,
      flowerName: line.wiki.chineseName,
      quantityNeeded: line.quantityNeeded,
      standardUnitCost: line.wiki.standardUnitCost ?? null,
    }))
  );
  const packagingCost = recipe.packagingKit
    ? money(recipe.packagingKit.standardCost)
    : money(0);
  const warnings = [...material.warnings];
  if (!recipe.packagingKit) {
    warnings.push(`配方「${recipe.name}」未绑定包装方案，包装成本按 0 计算`);
  }
  const missingStandardCostCount = material.lines.filter(
    (line) => line.standardUnitCost === null
  ).length;
  const totalCost = money(material.materialCost.plus(packagingCost));

  return {
    materialCost: decimalToString(material.materialCost),
    packagingCost: decimalToString(packagingCost),
    totalCost: decimalToString(totalCost),
    missingStandardCostCount,
    isComplete: missingStandardCostCount === 0,
    lines: material.lines,
    warnings,
  };
}

export function parseRecipeIngredients(raw: unknown): RecipeIngredientInput[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  const list = body.ingredients;
  if (!Array.isArray(list)) {
    throw new Error("ingredients 须为数组");
  }

  const parsed: RecipeIngredientInput[] = list.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 行配方格式无效`);
    }
    const row = item as Record<string, unknown>;
    const flowerWikiId =
      typeof row.flowerWikiId === "string" ? row.flowerWikiId.trim() : "";
    const quantity = Math.round(Number(row.quantity));
    if (!flowerWikiId) {
      throw new Error(`第 ${index + 1} 行缺少 flowerWikiId`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`第 ${index + 1} 行数量须为正整数`);
    }
    return { flowerWikiId, quantity };
  });

  const ids = parsed.map((p) => p.flowerWikiId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("配方中存在重复花材，请合并数量后保存");
  }

  return parsed;
}

function parseRequiredRecipeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new Error("配方名称不能为空");
  return name;
}

function parsePackagingKitId(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error("packagingKitId 须为字符串或 null");
  }
  return raw.trim() || null;
}

const RECIPE_CODE_PATTERN = /^BOM-(\d{8})-(\d{3})$/;

export function formatRecipeDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export async function generateNextRecipeCode(
  tx: Tx,
  date = new Date()
): Promise<string> {
  const dateKey = formatRecipeDateKey(date);
  const prefix = `BOM-${dateKey}-`;

  const latest = await tx.recipe.findFirst({
    where: { recipeCode: { startsWith: prefix } },
    orderBy: { recipeCode: "desc" },
    select: { recipeCode: true },
  });

  let nextSeq = 1;
  if (latest?.recipeCode) {
    const match = RECIPE_CODE_PATTERN.exec(latest.recipeCode);
    if (match && match[1] === dateKey) {
      nextSeq = Number.parseInt(match[2], 10) + 1;
    }
  }

  if (nextSeq > 999) {
    throw new Error("当日配方流水号已用尽，请明日再试");
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
}

async function assertWikiIdsExist(
  tx: Tx,
  ingredients: RecipeIngredientInput[]
): Promise<void> {
  const ids = ingredients.map((i) => i.flowerWikiId);
  const found = await tx.flowerWiki.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new Error("配方中存在无效的花材母表 ID");
  }
}

async function assertPackagingKitActive(
  tx: Tx,
  packagingKitId: string | null | undefined
): Promise<void> {
  if (!packagingKitId) return;
  const kit = await tx.packagingKit.findFirst({
    where: { id: packagingKitId, isActive: true },
    select: { id: true },
  });
  if (!kit) throw new Error("所选包装方案不存在或已停用");
}

async function loadRecipeById(id: string, tx: Tx = prisma): Promise<RecipeSummary> {
  const recipe = await tx.recipe.findUnique({
    where: { id },
    include: {
      lines: { include: lineInclude, orderBy: { quantityNeeded: "desc" } },
      packagingKit: { select: { id: true, name: true, standardCost: true } },
      _count: { select: { skus: true } },
    },
  });
  if (!recipe) throw new Error("配方不存在");
  return serializeRecipe(recipe);
}

/** 仅写入 recipes + recipe_lines（标准工艺公式，零库存副作用） */
async function writeRecipeLines(
  tx: Tx,
  recipeId: string,
  ingredients: RecipeIngredientInput[]
): Promise<void> {
  await tx.recipeLine.deleteMany({ where: { recipeId } });
  if (ingredients.length === 0) return;

  await assertWikiIdsExist(tx, ingredients);

  await tx.recipeLine.createMany({
    data: ingredients.map((ing) => ({
      recipeId,
      flowerWikiId: ing.flowerWikiId,
      quantityNeeded: ing.quantity,
    })),
  });
}

export async function listRecipes(): Promise<RecipeListItem[]> {
  const recipes = await prisma.recipe.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      lines: { include: lineInclude },
      packagingKit: { select: { name: true, standardCost: true } },
      _count: { select: { skus: true } },
    },
  });

  return recipes.map((recipe) => {
    const ingredients = mapRecipeLines(recipe.lines);
    const standardCost = buildRecipeCostPreview(recipe);
    return {
      id: recipe.id,
      recipeCode: recipe.recipeCode,
      name: recipe.name,
      ingredientSummary: formatIngredientSummary(ingredients),
      packagingKitName: recipe.packagingKit?.name ?? null,
      packagingKitStandardCost:
        recipe.packagingKit?.standardCost.toFixed(2) ?? null,
      standardMaterialCost: standardCost.materialCost,
      standardPackagingCost: standardCost.packagingCost,
      standardTotalCost: standardCost.totalCost,
      missingStandardCostCount: standardCost.missingStandardCostCount,
      productCount: recipe._count.skus,
      ingredientCount: ingredients.length,
    };
  });
}

export async function getRecipeById(id: string): Promise<RecipeSummary> {
  return loadRecipeById(id);
}

export async function createRecipe(raw: unknown): Promise<RecipeSummary> {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  const name = parseRequiredRecipeName(body.name);
  const description =
    typeof body.description === "string"
      ? body.description.trim() || null
      : null;
  const packagingKitId = parsePackagingKitId(body.packagingKitId) ?? null;
  const ingredients = parseRecipeIngredients(raw);

  if (ingredients.length === 0) {
    throw new Error("请至少添加一种大仓物料");
  }

  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const recipeCode = await generateNextRecipeCode(tx);
          await assertPackagingKitActive(tx, packagingKitId);

          const recipe = await tx.recipe.create({
            data: { recipeCode, name, description, packagingKitId },
            select: { id: true },
          });
          await writeRecipeLines(tx, recipe.id, ingredients);
          return loadRecipeById(recipe.id, tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("配方流水号生成冲突，请重试");
}

export async function updateRecipe(
  id: string,
  raw: unknown
): Promise<RecipeSummary> {
  if (!raw || typeof raw !== "object") {
    throw new Error("请求体须为 JSON 对象");
  }
  const body = raw as Record<string, unknown>;
  const ingredients = parseRecipeIngredients(raw);

  if (ingredients.length === 0) {
    throw new Error("请至少保留一种大仓物料");
  }

  const existing = await prisma.recipe.findUnique({
    where: { id },
    select: { id: true, recipeCode: true, name: true },
  });
  if (!existing) throw new Error("配方不存在");

  const name =
    body.name !== undefined
      ? parseRequiredRecipeName(body.name)
      : existing.name;
  const description =
    body.description !== undefined
      ? typeof body.description === "string"
        ? body.description.trim() || null
        : null
      : undefined;
  const packagingKitId = parsePackagingKitId(body.packagingKitId);

  return prisma.$transaction(async (tx) => {
    await assertPackagingKitActive(tx, packagingKitId);
    await tx.recipe.update({
      where: { id },
      data: {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(packagingKitId !== undefined ? { packagingKitId } : {}),
      },
    });
    await writeRecipeLines(tx, id, ingredients);
    return loadRecipeById(id, tx);
  });
}

export async function assertRecipeExists(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true },
  });
  if (!recipe) throw new Error("所选大仓配方不存在");
}

export async function getRecipeForProduct(
  productId: string,
  skuId?: string
): Promise<RecipeSummary | null> {
  const spu = await prisma.productSpu.findFirst({
    where: {
      id: productId,
      isDeleted: false,
      skus: skuId
        ? { some: { id: skuId, recipeId: { not: null } } }
        : { some: { recipeId: { not: null } } },
    },
    select: {
      skus: {
        where: skuId
          ? { id: skuId, recipeId: { not: null } }
          : { recipeId: { not: null } },
        select: { recipeId: true },
        orderBy: { sortOrder: "asc" },
        take: 1,
      },
    },
  });
  const recipeId = spu?.skus[0]?.recipeId;
  if (!recipeId) return null;
  return getRecipeById(recipeId);
}
