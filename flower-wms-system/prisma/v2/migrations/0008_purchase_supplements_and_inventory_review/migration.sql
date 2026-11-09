ALTER TYPE "StocktakeState" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "StocktakeState" ADD VALUE 'REJECTED';

CREATE TYPE "PurchaseLineRelationKind" AS ENUM ('ORIGINAL', 'EXTRA_ORDER', 'REPLACEMENT_DELIVERY');
CREATE TYPE "InventoryReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "relationKind" "PurchaseLineRelationKind" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "sourceLineId" TEXT,
  ADD COLUMN "relationKey" TEXT;

ALTER TABLE "PurchaseOrderLine"
  ADD CONSTRAINT "PurchaseOrderLine_sourceLineId_fkey"
  FOREIGN KEY ("sourceLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderLine"
  ADD CONSTRAINT "PurchaseOrderLine_relation_source_check"
  CHECK (
    ("relationKind" = 'ORIGINAL' AND "sourceLineId" IS NULL)
    OR ("relationKind" <> 'ORIGINAL' AND "sourceLineId" IS NOT NULL AND "sourceLineId" <> "id")
  );

CREATE INDEX "PurchaseOrderLine_sourceLineId_relationKind_idx"
  ON "PurchaseOrderLine"("sourceLineId", "relationKind");
CREATE UNIQUE INDEX "PurchaseOrderLine_relationKey_key" ON "PurchaseOrderLine"("relationKey");

ALTER TABLE "Stocktake"
  ADD COLUMN "reviewReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "submittedById" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "LossRecord"
  ADD COLUMN "materialId" TEXT,
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "reviewStatus" "InventoryReviewStatus",
  ADD COLUMN "submittedById" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;

ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LossRecord_storeId_reviewStatus_occurredAt_idx"
  ON "LossRecord"("storeId", "reviewStatus", "occurredAt" DESC);
