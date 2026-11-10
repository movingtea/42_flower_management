-- E1.8 演练：V2 关键表行数与迁移历史核对（用于迁移前后/备份恢复后对比）
-- 输出格式：table_name|row_count
SELECT 'Tenant' AS table_name, count(*) AS row_count FROM "Tenant"
UNION ALL SELECT 'Store', count(*) FROM "Store"
UNION ALL SELECT 'StaffUser', count(*) FROM "StaffUser"
UNION ALL SELECT 'TenantMember', count(*) FROM "TenantMember"
UNION ALL SELECT 'StoreMember', count(*) FROM "StoreMember"
UNION ALL SELECT 'InventoryLocation', count(*) FROM "InventoryLocation"
UNION ALL SELECT 'StoreSettings', count(*) FROM "StoreSettings"
UNION ALL SELECT 'Material', count(*) FROM "Material"
UNION ALL SELECT 'ProductSku', count(*) FROM "ProductSku"
UNION ALL SELECT 'PurchaseOrder', count(*) FROM "PurchaseOrder"
UNION ALL SELECT 'PurchaseOrderLine', count(*) FROM "PurchaseOrderLine"
UNION ALL SELECT '_prisma_migrations_applied', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL
ORDER BY 1;
