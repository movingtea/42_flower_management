-- 订单状态枚举：待支付 / 已支付 / 已取消
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');

ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "orders"
ALTER COLUMN "status" TYPE "OrderStatus_new"
USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING_PAYMENT'::"OrderStatus_new"
    WHEN 'PAID' THEN 'PAID'::"OrderStatus_new"
    WHEN 'PREPARING' THEN 'PAID'::"OrderStatus_new"
    WHEN 'DELIVERED' THEN 'PAID'::"OrderStatus_new"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderStatus_new"
    ELSE 'PENDING_PAYMENT'::"OrderStatus_new"
  END
);

DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- 订单主表：运费与实付
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_fee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pay_amount" DOUBLE PRECISION;

UPDATE "orders"
SET "pay_amount" = COALESCE("pay_amount", "totalAmount"::double precision, 0)
WHERE "pay_amount" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "pay_amount" SET NOT NULL;

-- 回填 user_id（按微信 openId 关联）
UPDATE "orders" AS o
SET "user_id" = u."id"
FROM "users" AS u
WHERE o."user_id" IS NULL
  AND o."wechatOpenId" IS NOT NULL
  AND o."wechatOpenId" = u."open_id";

DELETE FROM "orders" WHERE "user_id" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "user_id" SET NOT NULL;

-- 列重命名为蛇形（与 Prisma @map 对齐）
ALTER TABLE "orders" RENAME COLUMN "orderNo" TO "order_no";
ALTER TABLE "orders" RENAME COLUMN "totalAmount" TO "total_amount";
ALTER TABLE "orders" RENAME COLUMN "receiverName" TO "receiver_name";
ALTER TABLE "orders" RENAME COLUMN "receiverPhone" TO "receiver_phone";
ALTER TABLE "orders" RENAME COLUMN "deliveryAddress" TO "delivery_address";
ALTER TABLE "orders" RENAME COLUMN "paidAt" TO "paid_at";
ALTER TABLE "orders" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "orders" RENAME COLUMN "updatedAt" TO "updated_at";

ALTER TABLE "orders" DROP COLUMN IF EXISTS "wechatOpenId";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "customerName";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "customerPhone";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "wechatTransactionId";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "deliveryTime";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "deliveredAt";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remark";

ALTER TABLE "orders" ALTER COLUMN "receiver_name" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "receiver_phone" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "delivery_address" SET NOT NULL;

ALTER TABLE "orders" ALTER COLUMN "total_amount" TYPE DOUBLE PRECISION USING "total_amount"::double precision;

-- 订单明细：SKU 快照
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sku_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "snapshot_product_name" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "snapshot_spec_name" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "snapshot_price" DOUBLE PRECISION;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "snapshot_image_url" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "order_items" AS oi
SET
  "sku_id" = ps."id",
  "snapshot_product_name" = oi."productName",
  "snapshot_spec_name" = COALESCE(ps."spec_name", oi."productSku"),
  "snapshot_price" = oi."unitPrice"::double precision,
  "snapshot_image_url" = COALESCE(oi."snapshot_product_image", ps."image_url", '')
FROM "product_skus" AS ps
WHERE oi."sku_id" IS NULL
  AND ps."spu_id" = oi."productId"
  AND ps."sku_code" = oi."productSku";

DELETE FROM "order_items" WHERE "sku_id" IS NULL;

ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_productId_fkey";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "productId";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "productName";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "productSku";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "snapshot_product_image";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "lineTotal";

ALTER TABLE "order_items" ALTER COLUMN "sku_id" SET NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "snapshot_product_name" SET NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "snapshot_spec_name" SET NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "snapshot_price" SET NOT NULL;
ALTER TABLE "order_items" ALTER COLUMN "snapshot_image_url" SET NOT NULL;

ALTER TABLE "order_items" RENAME COLUMN "orderId" TO "order_id";

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_sku_id_fkey"
FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "order_items_sku_id_idx" ON "order_items"("sku_id");
