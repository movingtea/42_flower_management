/*
  Warnings:

  - The `category` column on the `products` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('FLOWER', 'LEAF', 'PACK', 'FINISHED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryTime" TIMESTAMP(3),
ADD COLUMN     "receiverName" TEXT,
ADD COLUMN     "receiverPhone" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "category",
ADD COLUMN     "category" "ProductCategory" NOT NULL DEFAULT 'FLOWER',
ALTER COLUMN "sellPrice" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "orders_orderNo_idx" ON "orders"("orderNo");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");
