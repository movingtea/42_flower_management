-- 废除 products.category 字符串数组，改为 Category + ProductCategory 多对多

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

CREATE TABLE "product_categories" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("productId","categoryId")
);

CREATE INDEX "product_categories_categoryId_idx" ON "product_categories"("categoryId");

ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 预置 WMS 原材料分类
INSERT INTO "categories" ("id", "code", "name", "sortOrder", "updatedAt")
VALUES
    (gen_random_uuid()::text, 'FLOWER', '鲜花花材', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'LEAF', '叶材配叶', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'PACK', '包装周边', 3, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TOOL', '花艺工具', 4, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 从旧 products.category 数组迁移到 categories + product_categories
INSERT INTO "categories" ("id", "code", "name", "sortOrder", "updatedAt")
SELECT
    gen_random_uuid()::text,
    src.code,
    src.code,
    0,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT UPPER(TRIM(cat)) AS code
    FROM "products",
        UNNEST("category") AS cat
    WHERE cat IS NOT NULL AND TRIM(cat) <> ''
) AS src
WHERE NOT EXISTS (
    SELECT 1 FROM "categories" c WHERE c."code" = src.code
);

INSERT INTO "product_categories" ("productId", "categoryId")
SELECT DISTINCT p."id", c."id"
FROM "products" p
CROSS JOIN LATERAL UNNEST(p."category") AS cat_code
INNER JOIN "categories" c ON c."code" = UPPER(TRIM(cat_code))
WHERE cat_code IS NOT NULL AND TRIM(cat_code) <> '';

DROP INDEX IF EXISTS "products_category_idx";

ALTER TABLE "products" DROP COLUMN "category";
