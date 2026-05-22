-- 成品商品增加可售数量字段（安全库存仅保留在原材料 Material 表）

ALTER TABLE "products" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 0;
