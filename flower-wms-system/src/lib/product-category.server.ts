import type { ProductCategoryFlatRow, ProductCategoryTreeNode } from "@/lib/product-category";
import { buildProductCategoryTree } from "@/lib/product-category";
import { prisma } from "@/lib/prisma";

function mapRow(row: {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isActive: boolean;
  imageUrl: string | null;
}): ProductCategoryFlatRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    parentId: row.parentId,
    isActive: row.isActive,
    imageUrl: row.imageUrl,
  };
}

export async function loadAllProductCategoriesFlat(): Promise<ProductCategoryFlatRow[]> {
  const rows = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(mapRow);
}

export async function loadProductCategoryTree(): Promise<ProductCategoryTreeNode[]> {
  return buildProductCategoryTree(await loadAllProductCategoriesFlat());
}

/** 小程序首页：已启用的一级商品分类（含子分类） */
export async function loadWechatHomeProductCategories(): Promise<
  Array<{
    id: string;
    label: string;
    sortOrder: number;
    imageUrl: string | null;
    children: Array<{
      id: string;
      label: string;
      sortOrder: number;
      imageUrl: string | null;
    }>;
  }>
> {
  const tree = buildProductCategoryTree(
    (
      await prisma.productCategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      })
    ).map(mapRow)
  );

  return tree
    .filter((n) => !n.parentId)
    .map((root) => ({
      id: root.id,
      label: root.name,
      sortOrder: root.sortOrder,
      imageUrl: root.imageUrl,
      children: root.children
        .filter((c) => c.isActive)
        .map((c) => ({
          id: c.id,
          label: c.name,
          sortOrder: c.sortOrder,
          imageUrl: c.imageUrl,
        })),
    }));
}
