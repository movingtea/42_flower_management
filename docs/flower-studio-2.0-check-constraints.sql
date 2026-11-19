-- Draft supplements for a NEW 2.0 PostgreSQL database only.
-- Review together with generated initial migration; do not execute against the old schema.

ALTER TABLE "BatchBalance"
  ADD CONSTRAINT "BatchBalance_nonnegative_qty_chk"
  CHECK ("onHandQty" >= 0 AND "frozenQty" >= 0 AND "frozenQty" <= "onHandQty");

ALTER TABLE "InventoryReservation"
  ADD CONSTRAINT "InventoryReservation_positive_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "SampleInventoryReservation"
  ADD CONSTRAINT "SampleInventoryReservation_positive_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "AvailabilityHoldMaterial"
  ADD CONSTRAINT "AvailabilityHoldMaterial_positive_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "FutureSupplyAllocation"
  ADD CONSTRAINT "FutureSupplyAllocation_positive_qty_chk" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseDemandAllocation"
  ADD CONSTRAINT "PurchaseDemandAllocation_positive_qty_chk" CHECK ("allocatedQty" > 0);

ALTER TABLE "ProductSku"
  ADD CONSTRAINT "ProductSku_nonnegative_price_chk" CHECK ("price" >= 0);
ALTER TABLE "PaymentTransaction"
  ADD CONSTRAINT "PaymentTransaction_positive_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "RefundTransaction"
  ADD CONSTRAINT "RefundTransaction_positive_amount_chk" CHECK ("amount" > 0);

ALTER TABLE "StocktakeLine"
  ADD CONSTRAINT "StocktakeLine_nonnegative_count_chk" CHECK ("countedQty" >= 0 AND "recordedQty" >= 0);
ALTER TABLE "LossRecord"
  ADD CONSTRAINT "LossRecord_positive_qty_chk" CHECK ("quantity" > 0);

ALTER TABLE "SampleDisassemblyMaterial"
  ADD CONSTRAINT "SampleDisassemblyMaterial_nonnegative_qty_chk"
  CHECK ("usableQty" >= 0 AND "rejectedQty" >= 0);

-- Root ownership: the selected store, supplier, or product must belong to the same tenant.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_store_tenant_fkey"
  FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId");
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_store_tenant_fkey"
  FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId");
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplier_tenant_fkey"
  FOREIGN KEY ("supplierId", "tenantId") REFERENCES "Supplier"("id", "tenantId");
ALTER TABLE "SamplePlan"
  ADD CONSTRAINT "SamplePlan_store_tenant_fkey"
  FOREIGN KEY ("storeId", "tenantId") REFERENCES "Store"("id", "tenantId");
ALTER TABLE "Banner"
  ADD CONSTRAINT "Banner_product_tenant_fkey"
  FOREIGN KEY ("productId", "tenantId") REFERENCES "Product"("id", "tenantId");
