-- Sprint 22: nullable tenantId on core business tables (no FK, no index, no default)

ALTER TABLE "product_spus" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "product_skus" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "orders" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "customers" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "suppliers" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "materials" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "batches" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "stock_logs" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "recipes" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "purchase_orders" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "banners" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "cms_recommendation_slots" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "cms_home_scene_entries" ADD COLUMN "tenant_id" TEXT;
