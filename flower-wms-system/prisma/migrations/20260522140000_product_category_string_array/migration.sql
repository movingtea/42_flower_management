-- Product.category：单字符串 → 字符串数组（CMS 多选分类 / WMS 单元素）
ALTER TABLE "products" ALTER COLUMN "category" DROP DEFAULT;

ALTER TABLE "products"
ALTER COLUMN "category" TYPE TEXT[]
USING (
  CASE
    WHEN "category" IS NULL OR TRIM("category"::text) = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY[TRIM("category"::text)]
  END
);

ALTER TABLE "products" ALTER COLUMN "category" SET DEFAULT ARRAY[]::TEXT[];
