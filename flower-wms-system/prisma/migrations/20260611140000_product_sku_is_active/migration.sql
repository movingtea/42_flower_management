-- Sprint 13: ProductSku operational sellable state (distinct from stock / SPU shelf)
ALTER TABLE "product_skus" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "product_skus_spu_id_is_active_idx" ON "product_skus"("spu_id", "is_active");
