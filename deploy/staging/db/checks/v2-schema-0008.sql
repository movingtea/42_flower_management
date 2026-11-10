-- E1.8 演练：V2 增量迁移 0008 生效核对（枚举值、新增列、新增表）
-- 输出格式：item|value
SELECT 'enum_value:StocktakeState:PENDING_REVIEW' AS item,
       count(*)::text AS value
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'StocktakeState' AND e.enumlabel = 'PENDING_REVIEW'
UNION ALL
SELECT 'enum_value:StocktakeState:REJECTED', count(*)::text
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'StocktakeState' AND e.enumlabel = 'REJECTED'
UNION ALL
SELECT 'column:PurchaseOrderLine:relationKind', count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'PurchaseOrderLine' AND column_name = 'relationKind'
UNION ALL
SELECT 'column:PurchaseOrderLine:sourceLineId', count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'PurchaseOrderLine' AND column_name = 'sourceLineId'
UNION ALL
SELECT 'column:Stocktake:reviewReasons', count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Stocktake' AND column_name = 'reviewReasons'
UNION ALL
SELECT 'column:LossRecord:reviewStatus', count(*)::text
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'LossRecord' AND column_name = 'reviewStatus'
ORDER BY 1;
