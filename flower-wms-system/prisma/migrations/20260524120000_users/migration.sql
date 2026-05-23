-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "open_id" TEXT NOT NULL,
    "nick_name" TEXT,
    "avatar_url" TEXT,
    "default_receiver_name" TEXT,
    "default_receiver_phone" TEXT,
    "default_address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_open_id_key" ON "users"("open_id");

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
