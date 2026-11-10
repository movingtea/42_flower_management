-- E1.8 演练：V1 关键表行数与迁移历史核对
-- 输出格式：table_name|row_count
SELECT 'users' AS table_name, count(*) AS row_count FROM users
UNION ALL SELECT 'tenants', count(*) FROM tenants
UNION ALL SELECT 'tenant_members', count(*) FROM tenant_members
UNION ALL SELECT 'staff_users', count(*) FROM staff_users
UNION ALL SELECT 'product_spus', count(*) FROM product_spus
UNION ALL SELECT 'product_skus', count(*) FROM product_skus
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
UNION ALL SELECT '_prisma_migrations_applied', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL
ORDER BY 1;
