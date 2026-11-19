ALTER TABLE "Material"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Material_tenantId_active_name_idx"
  ON "Material"("tenantId", "active", "name");

ALTER TABLE "Supplier"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "wechat" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Supplier_tenantId_active_name_idx"
  ON "Supplier"("tenantId", "active", "name");
