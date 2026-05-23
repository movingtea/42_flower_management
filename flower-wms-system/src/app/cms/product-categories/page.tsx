import { ProductCategoryManager } from "@/app/cms/product-categories/ProductCategoryManager";
import { loadProductCategoryTree } from "@/lib/product-category.server";

export const dynamic = "force-dynamic";

export default async function CmsProductCategoriesPage() {
  const tree = await loadProductCategoryTree();
  return <ProductCategoryManager initialTree={tree} />;
}
