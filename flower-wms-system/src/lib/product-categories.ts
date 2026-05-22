import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Prisma 查询商品时附带分类的标准 include */
export const productCategoriesInclude = {
  categories: { include: { category: true } },
} as const;

export type ProductWithCategories = Prisma.ProductGetPayload<{
  include: typeof productCategoriesInclude;
}>;

/** 从已 include 的商品记录提取分类 key 列表 */
export function categoryKeysFromProduct(product: ProductWithCategories): string[] {
  return product.categories.map((pc) => pc.category.key);
}

/** @deprecated 请使用 categoryKeysFromProduct */
export function categoryCodesFromProduct(product: ProductWithCategories): string[] {
  return categoryKeysFromProduct(product);
}

type Tx = Prisma.TransactionClient | typeof prisma;

function normalizeCategoryKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function resolveCategoryName(
  key: string,
  labelByKey?: Map<string, string>
): string {
  const lower = normalizeCategoryKey(key);
  return labelByKey?.get(lower) ?? labelByKey?.get(lower.toUpperCase()) ?? lower;
}

/** 按 key 确保 Category 行存在，返回 id 列表 */
export async function ensureCategoryIdsByKeys(
  keys: string[],
  options?: { labelByKey?: Map<string, string>; tx?: Tx }
): Promise<string[]> {
  const client = options?.tx ?? prisma;
  const labelByKey = options?.labelByKey;
  const ids: string[] = [];

  for (const raw of keys) {
    const key = normalizeCategoryKey(raw);
    if (!key) continue;

    const row = await client.category.upsert({
      where: { key },
      create: {
        key,
        name: resolveCategoryName(key, labelByKey),
      },
      update: {
        name: resolveCategoryName(key, labelByKey),
      },
    });
    ids.push(row.id);
  }

  return ids;
}

/** @deprecated 请使用 ensureCategoryIdsByKeys */
export async function ensureCategoryIdsByCodes(
  codes: string[],
  options?: { labelByCode?: Map<string, string>; tx?: Tx }
): Promise<string[]> {
  return ensureCategoryIdsByKeys(codes, {
    labelByKey: options?.labelByCode,
    tx: options?.tx,
  });
}

/** 替换商品与分类的多对多关联（先删后建） */
export async function syncProductCategoryLinks(
  productId: string,
  keys: string[],
  options?: { labelByKey?: Map<string, string>; labelByCode?: Map<string, string>; tx?: Tx }
): Promise<void> {
  const client = options?.tx ?? prisma;
  const categoryIds = await ensureCategoryIdsByKeys(keys, {
    labelByKey: options?.labelByKey ?? options?.labelByCode,
    tx: options?.tx,
  });

  await client.productCategory.deleteMany({ where: { productId } });

  if (categoryIds.length === 0) return;

  await client.productCategory.createMany({
    data: categoryIds.map((categoryId) => ({ productId, categoryId })),
    skipDuplicates: true,
  });
}

/** 根据 CMS 分类配置构建 label 映射（key 为小写） */
export function cmsLabelByKey(
  items: { value: string; label: string }[]
): Map<string, string> {
  return new Map(
    items.map((i) => [i.value.trim().toLowerCase(), i.label])
  );
}

/** @deprecated 请使用 cmsLabelByKey */
export function cmsLabelByCode(
  items: { value: string; label: string }[]
): Map<string, string> {
  return cmsLabelByKey(items);
}

export const productBomInclude = {
  bomItems: { include: { material: true } },
} as const;
