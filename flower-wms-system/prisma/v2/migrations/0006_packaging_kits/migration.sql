CREATE TABLE "PackagingKit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackagingKit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackagingKit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PackagingKit_tenantId_code_key" ON "PackagingKit"("tenantId", "code");
CREATE INDEX "PackagingKit_tenantId_active_name_idx" ON "PackagingKit"("tenantId", "active", "name");

CREATE TABLE "PackagingKitLine" (
  "id" TEXT NOT NULL,
  "packagingKitId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  CONSTRAINT "PackagingKitLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PackagingKitLine_packagingKitId_fkey" FOREIGN KEY ("packagingKitId") REFERENCES "PackagingKit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PackagingKitLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PackagingKitLine_packagingKitId_materialId_key" ON "PackagingKitLine"("packagingKitId", "materialId");
