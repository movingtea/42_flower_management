ALTER TABLE "ProductSku"
  ADD COLUMN "estimatedConsumableCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedLaborCost" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "OrderItem"
  ADD COLUMN "estimatedConsumableCostSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedLaborCostSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "ProductSku"
  ADD CONSTRAINT "ProductSku_estimated_costs_nonnegative_chk"
  CHECK ("estimatedConsumableCost" >= 0 AND "estimatedLaborCost" >= 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_estimated_costs_nonnegative_chk"
  CHECK ("estimatedConsumableCostSnapshot" >= 0 AND "estimatedLaborCostSnapshot" >= 0);
