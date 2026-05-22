-- AlterTable
ALTER TABLE "products" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'RAW';

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");
