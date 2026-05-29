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
