-- Release-candidate key-query index.
--
-- Evidence: with 50 materials and 250 batches in one store, EXPLAIN showed
-- "Seq Scan on InventoryBatch" for the reservation-candidate / material-stock query:
--   WHERE "storeId" = $1
--     AND "materialId" = $2
--     AND ("usableUntil" IS NULL OR "usableUntil" >= $3)
-- The order-list query already uses "Order_storeId_deliveryAt_idx" and the audit
-- query already uses "AuditEvent_tenantId_occurredAt_idx", so no other indexes
-- are added here.
CREATE INDEX "InventoryBatch_storeId_materialId_idx"
  ON "InventoryBatch"("storeId", "materialId");
