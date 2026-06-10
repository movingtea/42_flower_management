-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('MINI_PROGRAM', 'WECHAT', 'XIAOHONGSHU', 'DOUYIN', 'FRIEND_REFERRAL', 'OFFLINE', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RecipientRelationType" AS ENUM ('SELF', 'PARTNER', 'MOTHER', 'FATHER', 'FAMILY', 'FRIEND', 'COLLEAGUE', 'CLIENT', 'TEACHER', 'OTHER');

-- CreateEnum
CREATE TYPE "GiftOccasionType" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'VALENTINE', 'QIXI', 'MOTHERS_DAY', 'GRADUATION', 'VISIT', 'APOLOGY', 'BUSINESS', 'OPENING', 'WEDDING', 'DAILY_SURPRISE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'FOLLOW_UP', 'FESTIVAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'DONE', 'SNOOZED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "mini_program_user_id" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "wechat_nickname" TEXT,
    "wechat_openid" TEXT,
    "wechat_unionid" TEXT,
    "source" "CustomerSource" NOT NULL DEFAULT 'MINI_PROGRAM',
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "first_order_at" TIMESTAMP(3),
    "last_order_at" TIMESTAMP(3),
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "average_order_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "birthday" TIMESTAMP(3),
    "preferred_colors" TEXT,
    "disliked_flowers" TEXT,
    "preference_note" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_recipient_relations" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "relation_type" "RecipientRelationType",
    "relation_label" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "source" "CustomerSource" NOT NULL DEFAULT 'MINI_PROGRAM',
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_recipient_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_occasions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "recipient_id" TEXT,
    "relation_id" TEXT,
    "order_id" TEXT,
    "occasion_type" "GiftOccasionType" NOT NULL,
    "occasion_label" TEXT,
    "important_date" TIMESTAMP(3),
    "gift_purpose" TEXT,
    "card_message" TEXT,
    "preference_snapshot" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_occasions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_reminders" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "occasion_id" TEXT,
    "order_id" TEXT,
    "type" "ReminderType" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "remind_at" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_reminders_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "customer_id" TEXT,
ADD COLUMN "recipient_id" TEXT,
ADD COLUMN "gift_occasion_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customers_mini_program_user_id_key" ON "customers"("mini_program_user_id");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_wechat_openid_idx" ON "customers"("wechat_openid");

-- CreateIndex
CREATE INDEX "customers_source_idx" ON "customers"("source");

-- CreateIndex
CREATE INDEX "customers_last_order_at_idx" ON "customers"("last_order_at");

-- CreateIndex
CREATE INDEX "recipients_phone_idx" ON "recipients"("phone");

-- CreateIndex
CREATE INDEX "recipients_name_idx" ON "recipients"("name");

-- CreateIndex
CREATE INDEX "customer_recipient_relations_customer_id_idx" ON "customer_recipient_relations"("customer_id");

-- CreateIndex
CREATE INDEX "customer_recipient_relations_recipient_id_idx" ON "customer_recipient_relations"("recipient_id");

-- CreateIndex
CREATE INDEX "customer_recipient_relations_customer_id_recipient_id_idx" ON "customer_recipient_relations"("customer_id", "recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_recipient_relations_customer_id_recipient_id_key" ON "customer_recipient_relations"("customer_id", "recipient_id");

-- CreateIndex
CREATE INDEX "gift_occasions_customer_id_idx" ON "gift_occasions"("customer_id");

-- CreateIndex
CREATE INDEX "gift_occasions_recipient_id_idx" ON "gift_occasions"("recipient_id");

-- CreateIndex
CREATE INDEX "gift_occasions_order_id_idx" ON "gift_occasions"("order_id");

-- CreateIndex
CREATE INDEX "gift_occasions_occasion_type_idx" ON "gift_occasions"("occasion_type");

-- CreateIndex
CREATE INDEX "gift_occasions_important_date_idx" ON "gift_occasions"("important_date");

-- CreateIndex
CREATE INDEX "customer_reminders_customer_id_idx" ON "customer_reminders"("customer_id");

-- CreateIndex
CREATE INDEX "customer_reminders_recipient_id_idx" ON "customer_reminders"("recipient_id");

-- CreateIndex
CREATE INDEX "customer_reminders_status_idx" ON "customer_reminders"("status");

-- CreateIndex
CREATE INDEX "customer_reminders_remind_at_idx" ON "customer_reminders"("remind_at");

-- CreateIndex
CREATE INDEX "customer_reminders_type_idx" ON "customer_reminders"("type");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_mini_program_user_id_fkey" FOREIGN KEY ("mini_program_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_recipient_relations" ADD CONSTRAINT "customer_recipient_relations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_recipient_relations" ADD CONSTRAINT "customer_recipient_relations_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_occasions" ADD CONSTRAINT "gift_occasions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_occasions" ADD CONSTRAINT "gift_occasions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_occasions" ADD CONSTRAINT "gift_occasions_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "customer_recipient_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reminders" ADD CONSTRAINT "customer_reminders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reminders" ADD CONSTRAINT "customer_reminders_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reminders" ADD CONSTRAINT "customer_reminders_occasion_id_fkey" FOREIGN KEY ("occasion_id") REFERENCES "gift_occasions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_gift_occasion_id_fkey" FOREIGN KEY ("gift_occasion_id") REFERENCES "gift_occasions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
