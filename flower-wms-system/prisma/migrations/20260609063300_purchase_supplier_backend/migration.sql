CREATE TYPE "SupplierType" AS ENUM (
  'LOCAL',
  'KUNMING_ONLINE',
  'WHOLESALE_MARKET',
  'PLATFORM',
  'OTHER'
);

CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT',
  'ORDERED',
  'RECEIVED',
  'CANCELLED'
);

CREATE TYPE "PurchaseCostAllocationMethod" AS ENUM (
  'BY_AMOUNT',
  'BY_QUANTITY'
);

CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "supplier_type" "SupplierType" NOT NULL,
  "contact_name" TEXT,
  "phone" TEXT,
  "wechat" TEXT,
  "address" TEXT,
  "note" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suppliers_name_idx" ON "suppliers"("name");
CREATE INDEX IF NOT EXISTS "suppliers_supplier_type_idx" ON "suppliers"("supplier_type");
CREATE INDEX IF NOT EXISTS "suppliers_is_active_idx" ON "suppliers"("is_active");

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" TEXT NOT NULL,
  "purchase_no" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "purchase_date" TIMESTAMP(3) NOT NULL,
  "expected_arrival_date" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "goods_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "shipping_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "packaging_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "other_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_extra_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "allocation_method" "PurchaseCostAllocationMethod" NOT NULL DEFAULT 'BY_AMOUNT',
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_purchase_no_key" ON "purchase_orders"("purchase_no");
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_purchase_date_idx" ON "purchase_orders"("purchase_date");
CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders"("status");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "flower_wiki_id" TEXT NOT NULL,
  "purchase_name" TEXT,
  "grade" TEXT,
  "color" TEXT,
  "spec" TEXT,
  "purchase_quantity" DECIMAL(12,2) NOT NULL,
  "purchase_unit" TEXT NOT NULL,
  "stems_per_unit" DECIMAL(12,2) NOT NULL,
  "total_stems" DECIMAL(12,2) NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "line_amount" DECIMAL(12,2) NOT NULL,
  "allocated_extra_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "actual_total_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "actual_unit_cost" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "supplier_sku_name" TEXT,
  "note" TEXT,
  "inbound_batch_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_lines_inbound_batch_id_key" ON "purchase_order_lines"("inbound_batch_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "purchase_order_lines_flower_wiki_id_idx" ON "purchase_order_lines"("flower_wiki_id");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_flower_wiki_id_fkey"
  FOREIGN KEY ("flower_wiki_id") REFERENCES "flower_wikis"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_inbound_batch_id_fkey"
  FOREIGN KEY ("inbound_batch_id") REFERENCES "batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
