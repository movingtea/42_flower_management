-- Category 树形结构：移除 key，新增 parentId / isActive / imageUrl

DROP INDEX IF EXISTS "categories_key_key";

ALTER TABLE "categories" DROP COLUMN IF EXISTS "key";

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

CREATE INDEX IF NOT EXISTS "categories_parentId_idx" ON "categories"("parentId");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
