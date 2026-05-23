import { MaterialCategoryManager } from "@/app/wms/material-categories/MaterialCategoryManager";
import { loadMaterialCategories } from "@/lib/material-category.server";

export const dynamic = "force-dynamic";

export default async function WmsMaterialCategoriesPage() {
  const list = await loadMaterialCategories();
  return <MaterialCategoryManager initialList={list} />;
}
