-- Purchase lists and receiving queues must use business creation order instead of
-- lexicographic purchase numbers. Existing rows receive the migration time; all
-- new rows use their actual database creation time.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "PurchaseOrder_tenantId_storeId_createdAt_idx"
  ON "PurchaseOrder"("tenantId", "storeId", "createdAt" DESC);
