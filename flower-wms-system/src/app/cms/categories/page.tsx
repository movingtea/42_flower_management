import { CategoryManager } from "@/app/cms/categories/CategoryManager";
import {
  CMS_PRODUCT_CATEGORIES_KEY,
  parseCmsProductCategoriesValue,
} from "@/lib/cms-product-categories";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CmsCategoriesPage() {
  const row = await prisma.appConfig.findUnique({
    where: { key: CMS_PRODUCT_CATEGORIES_KEY },
  });

  const categories = parseCmsProductCategoriesValue(row?.value ?? null);

  return (
    <CategoryManager
      initialCategories={categories}
      updatedAt={row?.updatedAt.toISOString() ?? null}
    />
  );
}
