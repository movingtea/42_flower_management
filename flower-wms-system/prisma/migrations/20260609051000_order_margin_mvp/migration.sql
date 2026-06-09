-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "packaging_kit_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_cost_actual" DECIMAL(10,2) DEFAULT 0,
ADD COLUMN     "delivery_cost_note" TEXT;

-- CreateTable
CREATE TABLE "packaging_kits" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "standard_cost" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packaging_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cost_snapshots" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "paid_amount" DECIMAL(10,2) NOT NULL,
    "flower_material_cost" DECIMAL(10,2) NOT NULL,
    "packaging_cost" DECIMAL(10,2) NOT NULL,
    "delivery_cost_actual" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "platform_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "florist_labor_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(10,2) NOT NULL,
    "gross_profit" DECIMAL(10,2) NOT NULL,
    "gross_margin" DECIMAL(10,4) NOT NULL,
    "cost_calculated_at" TIMESTAMP(3) NOT NULL,
    "cost_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_cost_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "packaging_kits_is_active_idx" ON "packaging_kits"("is_active");

-- CreateIndex
CREATE INDEX "packaging_kits_updated_at_idx" ON "packaging_kits"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_cost_snapshots_order_id_key" ON "order_cost_snapshots"("order_id");

-- CreateIndex
CREATE INDEX "order_cost_snapshots_cost_calculated_at_idx" ON "order_cost_snapshots"("cost_calculated_at");

-- CreateIndex
CREATE INDEX "recipes_packaging_kit_id_idx" ON "recipes"("packaging_kit_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_packaging_kit_id_fkey" FOREIGN KEY ("packaging_kit_id") REFERENCES "packaging_kits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cost_snapshots" ADD CONSTRAINT "order_cost_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
