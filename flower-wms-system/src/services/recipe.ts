import { Prisma } from "@/generated/prisma/client";
import { formatIngredientSummary } from "../lib/recipe-display";
import { prisma } from "@/lib/prisma";

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
  productCount: number;
  ingredients: RecipeIngredientRow[];
  createdAt: string;
  updatedAt: string;
};

export type RecipeListItem = {
  id: string;
  recipeCode: string;
  name: string;
  ingredientSummary: string;
  productCount: number;
  ingredientCount: number;
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
    _count: { products: number };
  }
): RecipeSummary {
  const ingredients = mapRecipeLines(recipe.lines);

  return {
    id: recipe.id,
    recipeCode: recipe.recipeCode,
    name: recipe.name,
    description: recipe.description,
    productCount: recipe._count.products,
    ingredients,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
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

async function loadRecipeById(id: string, tx: Tx = prisma): Promise<RecipeSummary> {
  const recipe = await tx.recipe.findUnique({
    where: { id },
    include: {
      lines: { include: lineInclude, orderBy: { quantityNeeded: "desc" } },
      _count: { select: { products: true } },
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
      _count: { select: { products: true } },
    },
  });

  return recipes.map((recipe) => {
    const ingredients = mapRecipeLines(recipe.lines);
    return {
      id: recipe.id,
      recipeCode: recipe.recipeCode,
      name: recipe.name,
      ingredientSummary: formatIngredientSummary(ingredients),
      productCount: recipe._count.products,
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

          const recipe = await tx.recipe.create({
            data: { recipeCode, name, description },
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

  return prisma.$transaction(async (tx) => {
    await tx.recipe.update({
      where: { id },
      data: {
        name,
        ...(description !== undefined ? { description } : {}),
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
  productId: string
): Promise<RecipeSummary | null> {
  const spu = await prisma.productSpu.findFirst({
    where: { id: productId, isDeleted: false },
    select: { recipeId: true },
  });
  if (!spu?.recipeId) return null;
  return getRecipeById(spu.recipeId);
}
