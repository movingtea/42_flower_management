-- BannerTargetType 枚举与 banners 表
CREATE TYPE "BannerTargetType" AS ENUM ('PRODUCT', 'ACTIVITY', 'COUPON', 'NONE');

CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "target_type" "BannerTargetType" NOT NULL DEFAULT 'NONE',
    "target_param" TEXT,
    "product_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "banners_sort_order_idx" ON "banners"("sort_order");
CREATE INDEX "banners_is_active_idx" ON "banners"("is_active");
CREATE INDEX "banners_target_type_idx" ON "banners"("target_type");

ALTER TABLE "banners" ADD CONSTRAINT "banners_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 订单明细：主图快照
ALTER TABLE "order_items" ADD COLUMN "snapshot_product_image" TEXT;
