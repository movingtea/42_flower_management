-- CreateEnum
CREATE TYPE "RecommendationSlotType" AS ENUM ('HOME_MAIN', 'HOME_SECONDARY', 'SCENE', 'FESTIVAL', 'NEW_ARRIVAL', 'HIGH_TICKET', 'CUSTOM');

-- AlterTable
ALTER TABLE "product_spus" ADD COLUMN "color_tags" JSONB,
ADD COLUMN "style_tags" JSONB,
ADD COLUMN "relationship_tags" JSONB,
ADD COLUMN "budget_tags" JSONB,
ADD COLUMN "positioning_tags" JSONB,
ADD COLUMN "selling_points" JSONB,
ADD COLUMN "operation_note" TEXT;

-- CreateTable
CREATE TABLE "cms_recommendation_slots" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slot_type" "RecommendationSlotType" NOT NULL,
    "scene_type" "GiftOccasionType",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "max_items" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_recommendation_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_recommendation_items" (
    "id" TEXT NOT NULL,
    "slot_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku_id" TEXT,
    "title_override" TEXT,
    "subtitle_override" TEXT,
    "image_override" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_recommendation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cms_recommendation_slots_key_key" ON "cms_recommendation_slots"("key");

-- CreateIndex
CREATE INDEX "cms_recommendation_slots_slot_type_idx" ON "cms_recommendation_slots"("slot_type");

-- CreateIndex
CREATE INDEX "cms_recommendation_slots_is_active_idx" ON "cms_recommendation_slots"("is_active");

-- CreateIndex
CREATE INDEX "cms_recommendation_slots_sort_order_idx" ON "cms_recommendation_slots"("sort_order");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_slot_id_idx" ON "cms_recommendation_items"("slot_id");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_product_id_idx" ON "cms_recommendation_items"("product_id");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_sku_id_idx" ON "cms_recommendation_items"("sku_id");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_is_active_idx" ON "cms_recommendation_items"("is_active");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_sort_order_idx" ON "cms_recommendation_items"("sort_order");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_start_at_idx" ON "cms_recommendation_items"("start_at");

-- CreateIndex
CREATE INDEX "cms_recommendation_items_end_at_idx" ON "cms_recommendation_items"("end_at");

-- AddForeignKey
ALTER TABLE "cms_recommendation_items" ADD CONSTRAINT "cms_recommendation_items_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "cms_recommendation_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_recommendation_items" ADD CONSTRAINT "cms_recommendation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product_spus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_recommendation_items" ADD CONSTRAINT "cms_recommendation_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
