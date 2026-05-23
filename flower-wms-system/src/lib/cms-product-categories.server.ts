import { flattenProductCategoryOptions } from "@/lib/product-category";
import type { CmsProductCategoryItem } from "@/lib/cms-product-categories";
import { loadAllProductCategoriesFlat } from "@/lib/product-category.server";

/** 从 ProductCategory 表加载商品可选分类（仅服务端） */
export async function loadCmsProductCategories(): Promise<
  CmsProductCategoryItem[]
> {
  const flat = await loadAllProductCategoriesFlat();
  const options = flattenProductCategoryOptions(flat, { activeOnly: true });

  return options.map((o) => ({
    id: o.id,
    label: o.label,
    sortOrder: o.sortOrder,
    parentId: o.parentId,
    depth: o.depth,
  }));
}
