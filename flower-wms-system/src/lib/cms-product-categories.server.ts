import {
  CMS_PRODUCT_CATEGORIES_KEY,
  parseCmsProductCategoriesValue,
  type CmsProductCategoryItem,
} from "@/lib/cms-product-categories";
import { prisma } from "@/lib/prisma";

/** 从数据库加载 CMS 商品分类（仅服务端） */
export async function loadCmsProductCategories(): Promise<
  CmsProductCategoryItem[]
> {
  const row = await prisma.appConfig.findUnique({
    where: { key: CMS_PRODUCT_CATEGORIES_KEY },
  });
  return parseCmsProductCategoriesValue(row?.value ?? null);
}
