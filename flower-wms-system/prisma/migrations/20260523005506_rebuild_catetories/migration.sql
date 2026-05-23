-- AlterTable
ALTER TABLE "product_categories_list" RENAME CONSTRAINT "categories_pkey" TO "product_categories_list_pkey";

-- RenameForeignKey
ALTER TABLE "product_categories_list" RENAME CONSTRAINT "categories_parentId_fkey" TO "product_categories_list_parent_id_fkey";

-- RenameIndex
ALTER INDEX "material_category_relations_material_id_material_category_id_ke" RENAME TO "material_category_relations_material_id_material_category_i_key";

-- RenameIndex
ALTER INDEX "product_categories_categoryId_idx" RENAME TO "product_categories_product_category_id_idx";

-- RenameIndex
ALTER INDEX "categories_parentId_idx" RENAME TO "product_categories_list_parent_id_idx";

-- RenameIndex
ALTER INDEX "categories_sortOrder_idx" RENAME TO "product_categories_list_sortOrder_idx";
