DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
    CREATE TYPE "Role" AS ENUM (
      'IT_ADMIN',
      'STORE_ADMIN',
      'WAREHOUSE_MANAGER',
      'FLORIST',
      'STORE_OPERATOR'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffAuditAction') THEN
    CREATE TYPE "StaffAuditAction" AS ENUM ('PASSWORD_RESET');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FloralRole') THEN
    CREATE TYPE "FloralRole" AS ENUM (
      'MAIN',
      'FILLER',
      'LINE',
      'FOLIAGE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "staff_users" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "display_name" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_users_username_key" ON "staff_users"("username");
CREATE INDEX IF NOT EXISTS "staff_users_role_idx" ON "staff_users"("role");

CREATE TABLE IF NOT EXISTS "flower_wikis" (
  "id" TEXT NOT NULL,
  "photo" TEXT,
  "english_name" TEXT NOT NULL,
  "chinese_name" TEXT NOT NULL,
  "pinyin_index" TEXT NOT NULL DEFAULT '',
  "color_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "morphology" TEXT,
  "supply_season" TEXT,
  "floral_role" "FloralRole" NOT NULL,
  "maintenance" TEXT NOT NULL,
  "alias_map" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "flower_wikis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "flower_wikis_english_name_key" ON "flower_wikis"("english_name");
CREATE INDEX IF NOT EXISTS "flower_wikis_chinese_name_idx" ON "flower_wikis"("chinese_name");
CREATE INDEX IF NOT EXISTS "flower_wikis_floral_role_idx" ON "flower_wikis"("floral_role");
CREATE INDEX IF NOT EXISTS "flower_wikis_pinyin_index_idx" ON "flower_wikis"("pinyin_index");

CREATE TABLE IF NOT EXISTS "recipes" (
  "id" TEXT NOT NULL,
  "recipe_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_recipe_code_key" ON "recipes"("recipe_code");
CREATE INDEX IF NOT EXISTS "recipes_name_idx" ON "recipes"("name");

ALTER TABLE "product_spus" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "wiki_id" TEXT;

CREATE TABLE IF NOT EXISTS "recipe_lines" (
  "id" TEXT NOT NULL,
  "recipe_id" TEXT NOT NULL,
  "flower_wiki_id" TEXT NOT NULL,
  "quantity_needed" INTEGER NOT NULL,

  CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipe_lines_recipe_id_flower_wiki_id_key"
  ON "recipe_lines"("recipe_id", "flower_wiki_id");
CREATE INDEX IF NOT EXISTS "recipe_lines_flower_wiki_id_idx" ON "recipe_lines"("flower_wiki_id");

CREATE TABLE IF NOT EXISTS "stock_loss_records" (
  "id" TEXT NOT NULL,
  "flower_wiki_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "loss_quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "operator" TEXT,
  "operator_staff_id" TEXT,
  "stock_log_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_loss_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_loss_records_stock_log_id_key"
  ON "stock_loss_records"("stock_log_id");
CREATE INDEX IF NOT EXISTS "stock_loss_records_flower_wiki_id_created_at_idx"
  ON "stock_loss_records"("flower_wiki_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_loss_records_batch_id_created_at_idx"
  ON "stock_loss_records"("batch_id", "created_at");

CREATE TABLE IF NOT EXISTS "staff_audit_logs" (
  "id" TEXT NOT NULL,
  "action" "StaffAuditAction" NOT NULL,
  "operator_staff_id" TEXT NOT NULL,
  "target_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "staff_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "staff_audit_logs_operator_staff_id_created_at_idx"
  ON "staff_audit_logs"("operator_staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "staff_audit_logs_target_staff_id_created_at_idx"
  ON "staff_audit_logs"("target_staff_id", "created_at");
CREATE INDEX IF NOT EXISTS "staff_audit_logs_action_created_at_idx"
  ON "staff_audit_logs"("action", "created_at");

ALTER TABLE "stock_logs" ADD COLUMN IF NOT EXISTS "operator_staff_id" TEXT;
ALTER TABLE "stock_loss_records" ADD COLUMN IF NOT EXISTS "operator_staff_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_audit_logs_operator_staff_id_fkey'
  ) THEN
    ALTER TABLE "staff_audit_logs"
      ADD CONSTRAINT "staff_audit_logs_operator_staff_id_fkey"
      FOREIGN KEY ("operator_staff_id") REFERENCES "staff_users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_audit_logs_target_staff_id_fkey'
  ) THEN
    ALTER TABLE "staff_audit_logs"
      ADD CONSTRAINT "staff_audit_logs_target_staff_id_fkey"
      FOREIGN KEY ("target_staff_id") REFERENCES "staff_users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_logs_operator_staff_id_fkey'
  ) THEN
    ALTER TABLE "stock_logs"
      ADD CONSTRAINT "stock_logs_operator_staff_id_fkey"
      FOREIGN KEY ("operator_staff_id") REFERENCES "staff_users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_spus_recipe_id_fkey'
  ) THEN
    ALTER TABLE "product_spus"
      ADD CONSTRAINT "product_spus_recipe_id_fkey"
      FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materials_wiki_id_fkey'
  ) THEN
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_wiki_id_fkey"
      FOREIGN KEY ("wiki_id") REFERENCES "flower_wikis"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipe_lines_recipe_id_fkey'
  ) THEN
    ALTER TABLE "recipe_lines"
      ADD CONSTRAINT "recipe_lines_recipe_id_fkey"
      FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipe_lines_flower_wiki_id_fkey'
  ) THEN
    ALTER TABLE "recipe_lines"
      ADD CONSTRAINT "recipe_lines_flower_wiki_id_fkey"
      FOREIGN KEY ("flower_wiki_id") REFERENCES "flower_wikis"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_loss_records_flower_wiki_id_fkey'
  ) THEN
    ALTER TABLE "stock_loss_records"
      ADD CONSTRAINT "stock_loss_records_flower_wiki_id_fkey"
      FOREIGN KEY ("flower_wiki_id") REFERENCES "flower_wikis"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_loss_records_batch_id_fkey'
  ) THEN
    ALTER TABLE "stock_loss_records"
      ADD CONSTRAINT "stock_loss_records_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "batches"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_loss_records_stock_log_id_fkey'
  ) THEN
    ALTER TABLE "stock_loss_records"
      ADD CONSTRAINT "stock_loss_records_stock_log_id_fkey"
      FOREIGN KEY ("stock_log_id") REFERENCES "stock_logs"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_loss_records_operator_staff_id_fkey'
  ) THEN
    ALTER TABLE "stock_loss_records"
      ADD CONSTRAINT "stock_loss_records_operator_staff_id_fkey"
      FOREIGN KEY ("operator_staff_id") REFERENCES "staff_users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_logs_operator_staff_id_idx" ON "stock_logs"("operator_staff_id");
CREATE INDEX IF NOT EXISTS "stock_loss_records_operator_staff_id_idx" ON "stock_loss_records"("operator_staff_id");
CREATE INDEX IF NOT EXISTS "product_spus_recipe_id_idx" ON "product_spus"("recipe_id");
CREATE INDEX IF NOT EXISTS "materials_wiki_id_idx" ON "materials"("wiki_id");
