-- 拆表：Product（前台成品）+ Material（仓储原材料）+ ProductBOM + Category.key

-- ---------------------------------------------------------------------------
-- 1. 原材料表
-- ---------------------------------------------------------------------------
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "safetyStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "materials_materialCode_key" ON "materials"("materialCode");

-- 从原 products（type = RAW）迁入原材料，保留原 id 以复用批次外键
INSERT INTO "materials" ("id", "materialCode", "name", "unit", "safetyStockThreshold", "updatedAt")
SELECT
    p."id",
    p."sku",
    p."name",
    COALESCE(NULLIF(TRIM(p."unit"), ''), '支'),
    p."safetyStockThreshold",
    p."updatedAt"
FROM "products" p
WHERE p."type" = 'RAW';

-- ---------------------------------------------------------------------------
-- 2. 批次 / 流水改挂 Material
-- ---------------------------------------------------------------------------
ALTER TABLE "batches" ADD COLUMN "materialId" TEXT;

UPDATE "batches" b
SET "materialId" = b."productId"
FROM "products" p
WHERE b."productId" = p."id" AND p."type" = 'RAW';

ALTER TABLE "batches" DROP CONSTRAINT IF EXISTS "batches_productId_fkey";
DROP INDEX IF EXISTS "batches_productId_inboundAt_idx";
DROP INDEX IF EXISTS "batches_productId_remainingQty_idx";
ALTER TABLE "batches" DROP COLUMN "productId";
ALTER TABLE "batches" ALTER COLUMN "materialId" SET NOT NULL;

ALTER TABLE "batches" ADD CONSTRAINT "batches_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "batches_materialId_inboundAt_idx" ON "batches"("materialId", "inboundAt");
CREATE INDEX "batches_materialId_remainingQty_idx" ON "batches"("materialId", "remainingQty");

ALTER TABLE "stock_logs" ADD COLUMN "materialId" TEXT;

UPDATE "stock_logs" sl
SET "materialId" = sl."productId"
FROM "products" p
WHERE sl."productId" = p."id" AND p."type" = 'RAW';

ALTER TABLE "stock_logs" DROP CONSTRAINT IF EXISTS "stock_logs_productId_fkey";
DROP INDEX IF EXISTS "stock_logs_productId_createdAt_idx";
ALTER TABLE "stock_logs" DROP COLUMN "productId";
ALTER TABLE "stock_logs" ALTER COLUMN "materialId" SET NOT NULL;

ALTER TABLE "stock_logs" ADD CONSTRAINT "stock_logs_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_logs_materialId_createdAt_idx" ON "stock_logs"("materialId", "createdAt");

-- ---------------------------------------------------------------------------
-- 3. Category：code → key（小写）
-- ---------------------------------------------------------------------------
ALTER TABLE "categories" RENAME COLUMN "code" TO "key";
UPDATE "categories" SET "key" = LOWER("key");

DROP INDEX IF EXISTS "categories_code_key";
CREATE UNIQUE INDEX "categories_key_key" ON "categories"("key");

-- ---------------------------------------------------------------------------
-- 4. Product 表重塑（仅保留 type = PRODUCT 行）
-- ---------------------------------------------------------------------------
DELETE FROM "product_categories" pc
USING "products" p
WHERE pc."productId" = p."id" AND p."type" = 'RAW';

DELETE FROM "order_items" oi
USING "products" p
WHERE oi."productId" = p."id" AND p."type" = 'RAW';

DELETE FROM "products" WHERE "type" = 'RAW';

ALTER TABLE "products" ADD COLUMN "price_new" DECIMAL(10, 2);
ALTER TABLE "products" ADD COLUMN "costPrice" DECIMAL(10, 2);
ALTER TABLE "products" ADD COLUMN "subtitle" TEXT;
ALTER TABLE "products" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN "detailContent" TEXT;
ALTER TABLE "products" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "products" ADD COLUMN "isOutOfStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "allowPreOrder" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN "productionTime" INTEGER NOT NULL DEFAULT 30;

UPDATE "products"
SET
    "price_new" = COALESCE("sellPrice", 0),
    "subtitle" = LEFT(COALESCE("description", ''), 500),
    "images" = CASE
        WHEN "imageUrl" IS NOT NULL AND TRIM("imageUrl") <> '' THEN ARRAY[TRIM("imageUrl")]
        ELSE ARRAY[]::TEXT[]
    END,
    "detailContent" = COALESCE("description", "careTips"),
    "status" = CASE WHEN "isActive" = true THEN 'PUBLISHED' ELSE 'ARCHIVED' END;

ALTER TABLE "products" DROP COLUMN "type";
ALTER TABLE "products" DROP COLUMN "unit";
ALTER TABLE "products" DROP COLUMN "description";
ALTER TABLE "products" DROP COLUMN "careTips";
ALTER TABLE "products" DROP COLUMN "imageUrl";
ALTER TABLE "products" DROP COLUMN "sellPrice";
ALTER TABLE "products" DROP COLUMN "safetyStockThreshold";
ALTER TABLE "products" DROP COLUMN "isActive";

ALTER TABLE "products" RENAME COLUMN "price_new" TO "price";
ALTER TABLE "products" ALTER COLUMN "price" SET NOT NULL;

DROP INDEX IF EXISTS "products_type_idx";
DROP INDEX IF EXISTS "products_isActive_idx";
CREATE INDEX "products_status_idx" ON "products"("status");

-- product_categories 外键：Category 删除改为 CASCADE
ALTER TABLE "product_categories" DROP CONSTRAINT IF EXISTS "product_categories_categoryId_fkey";
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. 配方表
-- ---------------------------------------------------------------------------
CREATE TABLE "product_bom" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantityNeeded" INTEGER NOT NULL,

    CONSTRAINT "product_bom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_bom_productId_materialId_key" ON "product_bom"("productId", "materialId");
CREATE INDEX "product_bom_materialId_idx" ON "product_bom"("materialId");

ALTER TABLE "product_bom" ADD CONSTRAINT "product_bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bom" ADD CONSTRAINT "product_bom_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
