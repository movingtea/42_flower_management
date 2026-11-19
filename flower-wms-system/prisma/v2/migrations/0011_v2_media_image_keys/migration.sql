-- A06 / V2 media references.
--
-- imageKey stores the OSS objectKey (never a URL or a local /uploads path).
-- All three columns are nullable so existing rows remain valid and the upgrade
-- is non-destructive. WMS image modules write under:
--   universe42/wms/materials/...
--   universe42/wms/products/...
--   universe42/wms/skus/...
ALTER TABLE "Material" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageKey" TEXT;
ALTER TABLE "ProductSku" ADD COLUMN "imageKey" TEXT;
