-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN "item_type" TEXT NOT NULL DEFAULT 'FLOWER';
ALTER TABLE "purchase_order_lines" ADD COLUMN "master_part_id" TEXT;
ALTER TABLE "purchase_order_lines" ALTER COLUMN "flower_wiki_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "purchase_order_lines_item_type_idx" ON "purchase_order_lines"("item_type");
CREATE INDEX "purchase_order_lines_master_part_id_idx" ON "purchase_order_lines"("master_part_id");

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
