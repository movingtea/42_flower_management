-- Banner 有效期与软删除字段
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "starts_at" TIMESTAMP(3);
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "ends_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "banners_is_deleted_idx" ON "banners"("is_deleted");
CREATE INDEX IF NOT EXISTS "banners_starts_at_idx" ON "banners"("starts_at");
CREATE INDEX IF NOT EXISTS "banners_ends_at_idx" ON "banners"("ends_at");
