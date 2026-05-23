import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Prisma 查询商品时附带商品分类的标准 include */
export const productCategoriesInclude = {
  categories: { include: { productCategory: true } },
} as const;

export type ProductWithCategories = Prisma.ProductGetPayload<{
  include: typeof productCategoriesInclude;
}>;

/** 从已 include 的商品记录提取商品分类 id 列表 */
export function categoryIdsFromProduct(
  product: ProductWithCategories
): string[] {
  return product.categories.map((pc) => pc.productCategoryId);
}

/** @deprecated 请使用 categoryIdsFromProduct */
export function categoryKeysFromProduct(
  product: ProductWithCategories
): string[] {
  return categoryIdsFromProduct(product);
}

type Tx = Prisma.TransactionClient | typeof prisma;

/** 校验商品分类 id 均存在 */
export async function ensureProductCategoryIds(
  ids: string[],
  options?: { tx?: Tx }
): Promise<string[]> {
  const client = options?.tx ?? prisma;
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (unique.length === 0) {
    throw new Error("请至少选择一个商品分类");
  }

  const found = await client.productCategory.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });

  if (found.length !== unique.length) {
    const foundSet = new Set(found.map((r) => r.id));
    const missing = unique.filter((id) => !foundSet.has(id));
    throw new Error(`商品分类不存在：${missing.join(", ")}`);
  }

  return unique;
}

/**
 * 保存商品前解析分类：店长勾选的 id + 子分类自动追溯的父分类 id（去重）。
 * 前端只需提交实际勾选的 category / categoryIds，父级由服务端补齐。
 */
export async function resolveProductCategoryIdsForSave(
  categoryIds: string[],
  options?: { tx?: Tx }
): Promise<string[]> {
  const client = options?.tx ?? prisma;
  const selected = [
    ...new Set(categoryIds.map((id) => id.trim()).filter(Boolean)),
  ];

  if (selected.length === 0) {
    throw new Error("请至少选择一个商品分类");
  }

  const rows = await client.productCategory.findMany({
    where: { id: { in: selected } },
    select: { id: true, parentId: true },
  });

  if (rows.length !== selected.length) {
    const foundSet = new Set(rows.map((r) => r.id));
    const missing = selected.filter((id) => !foundSet.has(id));
    throw new Error(`商品分类不存在：${missing.join(", ")}`);
  }

  const finalIds = new Set<string>();
  for (const row of rows) {
    finalIds.add(row.id);
    if (row.parentId) {
      finalIds.add(row.parentId);
    }
  }

  return Array.from(finalIds);
}

/**
 * 编辑页回显：若子分类已选且父分类因自动关联存在，则不在 UI 中勾选父级（保存时仍会由服务端补齐）。
 */
export function filterEditorDisplayCategoryIds(
  linkedIds: string[],
  rows: { id: string; parentId: string | null }[]
): string[] {
  const linked = new Set(linkedIds);
  const omitParents = new Set<string>();

  for (const row of rows) {
    if (row.parentId && linked.has(row.id) && linked.has(row.parentId)) {
      omitParents.add(row.parentId);
    }
  }

  return linkedIds.filter((id) => !omitParents.has(id));
}

/** @deprecated 请使用 ensureProductCategoryIds */
export const ensureCategoryIds = ensureProductCategoryIds;

/** 替换商品与商品分类的多对多关联（product_categories 中间表） */
export async function syncProductCategoryLinks(
  productId: string,
  categoryIds: string[],
  options?: { tx?: Tx }
): Promise<void> {
  const client = options?.tx ?? prisma;
  const ids = await resolveProductCategoryIdsForSave(categoryIds, {
    tx: options?.tx,
  });

  await client.productCategoryRelation.deleteMany({ where: { productId } });

  if (ids.length === 0) return;

  await client.productCategoryRelation.createMany({
    data: ids.map((productCategoryId) => ({
      productId,
      productCategoryId,
    })),
    skipDuplicates: true,
  });
}

export const productBomInclude = {
  bomItems: { include: { material: true } },
} as const;
