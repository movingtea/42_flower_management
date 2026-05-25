-- 重建 flower_wikis 表（新智库字段规范）
DROP TABLE IF EXISTS "flower_wikis" CASCADE;

CREATE TABLE "flower_wikis" (
    "id" TEXT NOT NULL,
    "photo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "english_name" TEXT,
    "color" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "texture" TEXT,
    "language" TEXT,
    "maintenance" TEXT NOT NULL,
    "alias" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flower_wikis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "flower_wikis_name_key" ON "flower_wikis"("name");
CREATE INDEX "flower_wikis_role_idx" ON "flower_wikis"("role");
CREATE INDEX "flower_wikis_color_idx" ON "flower_wikis"("color");

-- 清理旧版 materials.wiki_id 外键（若存在）
ALTER TABLE "materials" DROP CONSTRAINT IF EXISTS "materials_wiki_id_fkey";
ALTER TABLE "materials" DROP COLUMN IF EXISTS "wiki_id";

-- 清理旧版 FloralRole 枚举（若存在且无引用）
DROP TYPE IF EXISTS "FloralRole";
