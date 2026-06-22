-- AlterTable
ALTER TABLE "materials" ADD COLUMN "master_part_id" TEXT;

-- CreateIndex
CREATE INDEX "materials_master_part_id_idx" ON "materials"("master_part_id");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_master_part_id_fkey" FOREIGN KEY ("master_part_id") REFERENCES "master_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
