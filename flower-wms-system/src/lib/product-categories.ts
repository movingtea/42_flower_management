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

/** @deprecated 请使用 ensureProductCategoryIds */
export const ensureCategoryIds = ensureProductCategoryIds;

/** 替换商品与商品分类的多对多关联（product_categories 中间表） */
export async function syncProductCategoryLinks(
  productId: string,
  categoryIds: string[],
  options?: { tx?: Tx }
): Promise<void> {
  const client = options?.tx ?? prisma;
  const ids = await ensureProductCategoryIds(categoryIds, { tx: options?.tx });

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
