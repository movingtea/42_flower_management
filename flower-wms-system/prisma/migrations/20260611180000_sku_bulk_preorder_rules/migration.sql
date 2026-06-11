-- AlterTable
ALTER TABLE "product_skus" ADD COLUMN "bulk_preorder_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_skus" ADD COLUMN "bulk_order_threshold" INTEGER;
ALTER TABLE "product_skus" ADD COLUMN "bulk_min_lead_days" INTEGER;
ALTER TABLE "product_skus" ADD COLUMN "bulk_preorder_message" TEXT;
