-- 配方绑定从 product_spus 下沉至 product_skus（同 SPU 下各 SKU 可绑定不同 BOM）

ALTER TABLE "product_skus" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "product_skus" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- 将既有 SPU 级配方回填到其下所有 SKU
UPDATE "product_skus" AS sku
SET "recipe_id" = spu."recipe_id"
FROM "product_spus" AS spu
WHERE sku."spu_id" = spu."id"
  AND spu."recipe_id" IS NOT NULL
  AND sku."recipe_id" IS NULL;

ALTER TABLE "product_spus" DROP CONSTRAINT IF EXISTS "product_spus_recipe_id_fkey";
DROP INDEX IF EXISTS "product_spus_recipe_id_idx";
ALTER TABLE "product_spus" DROP COLUMN IF EXISTS "recipe_id";

ALTER TABLE "product_skus"
  ADD CONSTRAINT "product_skus_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "product_skus_recipe_id_idx" ON "product_skus"("recipe_id");
