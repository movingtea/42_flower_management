-- CreateTable
CREATE TABLE "master_parts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "default_unit" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "is_consumable" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_parts_type_idx" ON "master_parts"("type");

-- CreateIndex
CREATE INDEX "master_parts_is_active_idx" ON "master_parts"("is_active");

-- CreateIndex
CREATE INDEX "master_parts_name_idx" ON "master_parts"("name");
