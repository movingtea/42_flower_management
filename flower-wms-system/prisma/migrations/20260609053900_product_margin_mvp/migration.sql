-- AlterTable
ALTER TABLE "flower_wikis" ADD COLUMN     "cost_note" TEXT,
ADD COLUMN     "cost_unit" TEXT,
ADD COLUMN     "cost_updated_at" TIMESTAMP(3),
ADD COLUMN     "standard_unit_cost" DECIMAL(12,4);
