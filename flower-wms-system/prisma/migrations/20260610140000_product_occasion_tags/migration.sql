-- AlterTable
ALTER TABLE "product_spus" ADD COLUMN "occasion_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
