-- SPU / SKU 一维款式体系：由 products 表拆分

CREATE TABLE "product_spus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maintenance_guide" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "shipping_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allow_pre_order" BOOLEAN NOT NULL DEFAULT true,
    "production_time" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_spus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_spus_is_active_idx" ON "product_spus"("is_active");
CREATE INDEX "product_spus_is_deleted_idx" ON "product_spus"("is_deleted");

CREATE TABLE "product_skus" (
    "id" TEXT NOT NULL,
    "spu_id" TEXT NOT NULL,
    "sku_code" TEXT NOT NULL,
    "spec_name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "is_main_image" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_skus_sku_code_key" ON "product_skus"("sku_code");
CREATE INDEX "product_skus_spu_id_idx" ON "product_skus"("spu_id");
CREATE INDEX "product_skus_spu_id_is_main_image_idx" ON "product_skus"("spu_id", "is_main_image");

ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_spu_id_fkey" FOREIGN KEY ("spu_id") REFERENCES "product_spus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 从旧 products 迁移 SPU
INSERT INTO "product_spus" (
    "id",
    "name",
    "description",
    "maintenance_guide",
    "is_active",
    "is_deleted",
    "shipping_fee",
    "allow_pre_order",
    "production_time",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "name",
    COALESCE("detailContent", "subtitle"),
    NULL,
    ("status" = 'PUBLISHED'),
    "is_deleted",
    "shippingFee",
    "allowPreOrder",
    "productionTime",
    "createdAt",
    "updatedAt"
FROM "products";

-- 每个旧商品生成一条默认 SKU
INSERT INTO "product_skus" (
    "id",
    "spu_id",
    "sku_code",
    "spec_name",
    "price",
    "stock",
    "image_url",
    "is_main_image",
    "sort_order",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "sku",
    "name",
    "price",
    "quantity",
    CASE
        WHEN cardinality("images") > 0 THEN "images"[1]
        ELSE NULL
    END,
    true,
    0,
    "createdAt",
    "updatedAt"
FROM "products";

-- 外键改指向 product_spus（product_id 列名保留，语义为 spuId）
ALTER TABLE "product_categories" DROP CONSTRAINT IF EXISTS "product_categories_product_id_fkey";
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_spus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_bom" DROP CONSTRAINT IF EXISTS "product_bom_productId_fkey";
ALTER TABLE "product_bom" ADD CONSTRAINT "product_bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product_spus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_productId_fkey";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product_spus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "banners" DROP CONSTRAINT IF EXISTS "banners_product_id_fkey";
ALTER TABLE "banners" ADD CONSTRAINT "banners_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_spus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE "products";
