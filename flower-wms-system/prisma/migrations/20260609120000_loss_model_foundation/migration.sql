-- CreateEnum
CREATE TYPE "LossMode" AS ENUM ('OPTIMISTIC', 'STANDARD', 'CONSERVATIVE');

-- AlterTable
ALTER TABLE "flower_wikis" ADD COLUMN "default_usable_rate" DECIMAL(5,4),
ADD COLUMN "default_loss_rate" DECIMAL(5,4),
ADD COLUMN "loss_mode" "LossMode" DEFAULT 'STANDARD',
ADD COLUMN "optimistic_usable_rate" DECIMAL(5,4),
ADD COLUMN "standard_usable_rate" DECIMAL(5,4),
ADD COLUMN "conservative_usable_rate" DECIMAL(5,4),
ADD COLUMN "loss_rate_note" TEXT,
ADD COLUMN "loss_rate_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN "usable_rate" DECIMAL(5,4),
ADD COLUMN "loss_rate" DECIMAL(5,4),
ADD COLUMN "loss_adjusted_total_cost" DECIMAL(12,2),
ADD COLUMN "loss_adjusted_unit_cost" DECIMAL(12,4);

-- AlterTable
ALTER TABLE "batches" ADD COLUMN "loss_adjusted_unit_cost" DECIMAL(12,4),
ADD COLUMN "usable_rate" DECIMAL(5,4),
ADD COLUMN "loss_rate" DECIMAL(5,4);
