CREATE TYPE "OrderCancelSource" AS ENUM ('CUSTOMER', 'ADMIN', 'REFUND');

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_source" "OrderCancelSource";
