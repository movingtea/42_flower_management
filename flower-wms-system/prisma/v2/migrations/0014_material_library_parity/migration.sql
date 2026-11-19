-- Business Sprint 5: material library parity.
--
-- Promotes the V1 FlowerWiki / MasterPart library attributes onto the unified
-- V2 material master so that search pinyin, aliases, floral role, color tags,
-- morphology and loss policy can be edited from the WMS.
--
-- Every column is nullable or has a default, so existing material rows are
-- preserved without a data backfill. The pinyin/alias columns are intentionally
-- NOT backfilled here: the material service recomputes them on the next save.

CREATE TYPE "FloralRole" AS ENUM ('MAIN', 'FILLER', 'LINE', 'FOLIAGE');
CREATE TYPE "LossMode" AS ENUM ('OPTIMISTIC', 'STANDARD', 'CONSERVATIVE');

ALTER TABLE "Material"
  ADD COLUMN "pinyinIndex" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "aliasText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "floralRole" "FloralRole",
  ADD COLUMN "colorTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "morphology" TEXT,
  ADD COLUMN "aliasMap" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "defaultUsableRate" DECIMAL(7,4),
  ADD COLUMN "defaultLossRate" DECIMAL(7,4),
  ADD COLUMN "lossMode" "LossMode" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "lossRateUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "costUpdatedAt" TIMESTAMP(3);

CREATE INDEX "Material_tenantId_pinyinIndex_idx" ON "Material"("tenantId", "pinyinIndex");
