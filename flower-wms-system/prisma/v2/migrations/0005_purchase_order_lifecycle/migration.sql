ALTER TABLE "PurchaseOrder"
  ADD COLUMN "orderedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "packagingCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "otherCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "notes" TEXT;

ALTER TABLE "PurchaseOrderLine"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "PurchaseOrderLine_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderLine"("purchaseOrderId", "createdAt");
