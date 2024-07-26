/*
  Warnings:

  - Added the required column `password_hash` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "chats" DROP CONSTRAINT "chats_order_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_order_id_fkey";

-- DropForeignKey
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_order_id_fkey";

-- DropIndex
DROP INDEX "invoices_payment_hash_key";

-- AlterTable
ALTER TABLE "chats" ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "accept_offer_url" SET DATA TYPE TEXT,
ALTER COLUMN "token" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "bolt11" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "payment_hash" DROP NOT NULL,
ALTER COLUMN "payment_hash" SET DATA TYPE TEXT,
ALTER COLUMN "invoice_type" SET DATA TYPE TEXT,
ALTER COLUMN "user_type" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "order_details" SET DATA TYPE TEXT,
ALTER COLUMN "currency" SET DATA TYPE TEXT,
ALTER COLUMN "payment_method" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "escrow_status" SET DATA TYPE TEXT,
ALTER COLUMN "premium" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "payment_hashes" ALTER COLUMN "payment_hash" SET DATA TYPE TEXT,
ALTER COLUMN "payment_secret" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payouts" ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP NOT NULL,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" TEXT NOT NULL,
ALTER COLUMN "username" SET DATA TYPE TEXT,
ALTER COLUMN "password" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "invoice" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "payment_hash" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
