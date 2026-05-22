-- WMS / CMS 分类剥离：Product.category 由枚举改为字符串
ALTER TABLE "products" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

-- 历史成品 FINISHED 映射为 CMS 默认分类
UPDATE "products" SET "category" = 'BOUQUET' WHERE "type" = 'PRODUCT' AND "category" = 'FINISHED';

ALTER TABLE "products" ALTER COLUMN "category" SET DEFAULT 'FLOWER';

DROP TYPE IF EXISTS "ProductCategory";
