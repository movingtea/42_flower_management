-- CreateEnum
CREATE TYPE "HomeSceneEntryTargetType" AS ENUM ('PRODUCT_FILTER', 'RECOMMENDATION_SLOT', 'CUSTOM_URL');

-- CreateTable
CREATE TABLE "cms_home_scene_entries" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "scene_type" "GiftOccasionType" NOT NULL,
    "icon_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "target_type" "HomeSceneEntryTargetType" NOT NULL DEFAULT 'PRODUCT_FILTER',
    "target_value" TEXT,
    "linked_recommendation_slot_id" TEXT,
    "linked_recommendation_slot_key" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_home_scene_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cms_home_scene_entries_scene_type_idx" ON "cms_home_scene_entries"("scene_type");

-- CreateIndex
CREATE INDEX "cms_home_scene_entries_is_active_idx" ON "cms_home_scene_entries"("is_active");

-- CreateIndex
CREATE INDEX "cms_home_scene_entries_sort_order_idx" ON "cms_home_scene_entries"("sort_order");

-- CreateIndex
CREATE INDEX "cms_home_scene_entries_linked_recommendation_slot_id_idx" ON "cms_home_scene_entries"("linked_recommendation_slot_id");

-- CreateIndex
CREATE INDEX "cms_home_scene_entries_linked_recommendation_slot_key_idx" ON "cms_home_scene_entries"("linked_recommendation_slot_key");

-- AddForeignKey
ALTER TABLE "cms_home_scene_entries" ADD CONSTRAINT "cms_home_scene_entries_linked_recommendation_slot_id_fkey" FOREIGN KEY ("linked_recommendation_slot_id") REFERENCES "cms_recommendation_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
