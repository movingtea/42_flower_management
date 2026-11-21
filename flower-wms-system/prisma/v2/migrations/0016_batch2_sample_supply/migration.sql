-- Flower WMS V2 batch 2: multi-master sample scheduling, confirmed sample
-- substitution and the procurement-channel loss model.
--
-- Every new column is nullable or has a default, so existing samples, plans,
-- purchase lines and batches remain valid without a backfill.

-- ---------------------------------------------------------------------------
-- Sample photography / retention constraints and plan overrides
-- ---------------------------------------------------------------------------

ALTER TABLE "Sample"
  ADD COLUMN "photoDueAt" TIMESTAMP(3),
  ADD COLUMN "retentionUntil" TIMESTAMP(3);

ALTER TABLE "SamplePlanItem"
  ADD COLUMN "photoDueAt" TIMESTAMP(3),
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "autoSchedule" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SamplePlanStep"
  ADD COLUMN "plannedStartAt" TIMESTAMP(3),
  ADD COLUMN "plannedEndAt" TIMESTAMP(3),
  ADD COLUMN "photoDueAt" TIMESTAMP(3),
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "retained" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scheduleWarnings" JSONB;

-- ---------------------------------------------------------------------------
-- Confirmed sample material substitution
-- ---------------------------------------------------------------------------

CREATE TABLE "SampleMaterialSubstitution" (
  "id" TEXT NOT NULL,
  "sampleId" TEXT NOT NULL,
  "fromMaterialId" TEXT NOT NULL,
  "toMaterialId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "tier" TEXT NOT NULL,
  "reason" TEXT,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SampleMaterialSubstitution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SampleMaterialSubstitution_sampleId_confirmedAt_idx"
  ON "SampleMaterialSubstitution"("sampleId", "confirmedAt");
CREATE INDEX "SampleMaterialSubstitution_fromMaterialId_idx"
  ON "SampleMaterialSubstitution"("fromMaterialId");
CREATE INDEX "SampleMaterialSubstitution_toMaterialId_idx"
  ON "SampleMaterialSubstitution"("toMaterialId");

ALTER TABLE "SampleMaterialSubstitution"
  ADD CONSTRAINT "SampleMaterialSubstitution_sampleId_fkey"
  FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SampleMaterialSubstitution"
  ADD CONSTRAINT "SampleMaterialSubstitution_fromMaterialId_fkey"
  FOREIGN KEY ("fromMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SampleMaterialSubstitution"
  ADD CONSTRAINT "SampleMaterialSubstitution_toMaterialId_fkey"
  FOREIGN KEY ("toMaterialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Procurement-channel loss model
-- ---------------------------------------------------------------------------

ALTER TABLE "Supplier"
  ADD COLUMN "defaultLossRate" DECIMAL(7,4),
  ADD COLUMN "lossRateNote" TEXT,
  ADD COLUMN "lossRateUpdatedAt" TIMESTAMP(3);

ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "channelLossRate" DECIMAL(7,4),
  ADD COLUMN "expectedUsableQty" DECIMAL(14,3),
  ADD COLUMN "lossAdjustedUnitCost" DECIMAL(14,4);

ALTER TABLE "GoodsReceiptLine"
  ADD COLUMN "channelLossRate" DECIMAL(7,4);

ALTER TABLE "InventoryBatch"
  ADD COLUMN "channelLossRate" DECIMAL(7,4),
  ADD COLUMN "lossAdjustedUnitCost" DECIMAL(14,4);
