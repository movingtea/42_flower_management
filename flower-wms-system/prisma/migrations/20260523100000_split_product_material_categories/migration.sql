-- 商品分类与原材料分类解耦：重命名主表、扩展中间表、新建原材料分类体系

-- 1. 商品分类主表：categories → product_categories_list
ALTER TABLE "categories" RENAME TO "product_categories_list";

ALTER TABLE "product_categories_list" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- parentId 物理列改为 parent_id（外键蛇形）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_categories_list' AND column_name = 'parentId'
  ) THEN
    ALTER TABLE "product_categories_list" RENAME COLUMN "parentId" TO "parent_id";
  END IF;
END $$;

-- 2. 原材料分类主表
CREATE TABLE "material_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_categories_sortOrder_idx" ON "material_categories"("sortOrder");

-- 将误落在商品分类表中的 WMS 大类迁入 material_categories
INSERT INTO "material_categories" ("id", "name", "description", "isActive", "sortOrder", "updatedAt")
SELECT
    pcl."id",
    pcl."name",
    '由原仓储大类迁移',
    COALESCE(pcl."isActive", true),
    pcl."sortOrder",
    pcl."updatedAt"
FROM "product_categories_list" pcl
WHERE pcl."name" IN ('鲜花花材', '叶材配叶', '包装周边', '花艺工具')
   OR pcl."name" IN ('FLOWER', 'LEAF', 'PACK', 'TOOL')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "product_categories_list"
WHERE "name" IN ('鲜花花材', '叶材配叶', '包装周边', '花艺工具')
   OR "name" IN ('FLOWER', 'LEAF', 'PACK', 'TOOL');

-- 3. 商品 ↔ 分类中间表：增加 id，列名蛇形映射
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "id" TEXT;

UPDATE "product_categories"
SET "id" = gen_random_uuid()::text
WHERE "id" IS NULL;

ALTER TABLE "product_categories" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "product_categories" DROP CONSTRAINT IF EXISTS "product_categories_pkey";
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_categories' AND column_name = 'productId'
  ) THEN
    ALTER TABLE "product_categories" RENAME COLUMN "productId" TO "product_id";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_categories' AND column_name = 'categoryId'
  ) THEN
    ALTER TABLE "product_categories" RENAME COLUMN "categoryId" TO "product_category_id";
  END IF;
END $$;

ALTER TABLE "product_categories" DROP CONSTRAINT IF EXISTS "product_categories_categoryId_fkey";
ALTER TABLE "product_categories" DROP CONSTRAINT IF EXISTS "product_categories_productId_fkey";

ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_product_category_id_fkey"
  FOREIGN KEY ("product_category_id") REFERENCES "product_categories_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_product_id_product_category_id_key"
  ON "product_categories"("product_id", "product_category_id");

-- 4. 原材料 ↔ 分类中间表
CREATE TABLE "material_category_relations" (
    "id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "material_category_id" TEXT NOT NULL,

    CONSTRAINT "material_category_relations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_category_relations_material_id_material_category_id_key"
  ON "material_category_relations"("material_id", "material_category_id");

CREATE INDEX "material_category_relations_material_category_id_idx"
  ON "material_category_relations"("material_category_id");

ALTER TABLE "material_category_relations"
  ADD CONSTRAINT "material_category_relations_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_category_relations"
  ADD CONSTRAINT "material_category_relations_material_category_id_fkey"
  FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. 预置 WMS 原材料大类（若迁移未带入）
INSERT INTO "material_categories" ("id", "name", "description", "isActive", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, v.name, v.description, true, v.sort_order, CURRENT_TIMESTAMP
FROM (VALUES
    ('鲜花花材', '鲜切花与主花材', 1),
    ('叶材配叶', '配叶与填充花材', 2),
    ('包装周边', '包装纸、丝带等', 3),
    ('花艺工具', '剪刀、花泥等工具', 4)
) AS v(name, description, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "material_categories" mc WHERE mc."name" = v.name);
