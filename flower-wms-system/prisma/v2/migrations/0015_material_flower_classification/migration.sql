-- Flower three-level classification: variety -> product name -> color.
--
-- Adds 品种 (flowerVariety) and 商品名 (flowerProductName) to the unified V2
-- material master. 颜色 keeps using the existing `color` column, so no color
-- column is added here. Both new columns are nullable, so existing material
-- rows are preserved without a data backfill. The composite index supports the
-- cascading 品种 -> 商品名 filters used by the flower material list.

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "flowerProductName" TEXT,
ADD COLUMN     "flowerVariety" TEXT;

-- CreateIndex
CREATE INDEX "Material_tenantId_kind_flowerVariety_flowerProductName_idx" ON "Material"("tenantId", "kind", "flowerVariety", "flowerProductName");
