-- 商品软删除标记
ALTER TABLE "products" ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "products_is_deleted_idx" ON "products"("is_deleted");
