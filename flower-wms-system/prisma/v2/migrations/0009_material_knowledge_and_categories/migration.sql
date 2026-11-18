-- Business Sprint 1: unify V1 FlowerWiki knowledge and MasterPart attributes on Material.
ALTER TABLE "Material"
  ADD COLUMN "englishName" TEXT,
  ADD COLUMN "flowerLanguage" TEXT,
  ADD COLUMN "maintenance" TEXT,
  ADD COLUMN "maintenanceCare" JSONB,
  ADD COLUMN "supplySeason" TEXT,
  ADD COLUMN "defaultShelfLifeDays" INTEGER,
  ADD COLUMN "standardUnitCost" DECIMAL(14,4),
  ADD COLUMN "costUnit" TEXT,
  ADD COLUMN "costNote" TEXT,
  ADD COLUMN "optimisticUsableRate" DECIMAL(7,4),
  ADD COLUMN "standardUsableRate" DECIMAL(7,4),
  ADD COLUMN "conservativeUsableRate" DECIMAL(7,4),
  ADD COLUMN "lossRateNote" TEXT,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "safetyStockThreshold" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- V1 material categories carried a free-text description.
ALTER TABLE "MaterialCategory" ADD COLUMN "description" TEXT;
