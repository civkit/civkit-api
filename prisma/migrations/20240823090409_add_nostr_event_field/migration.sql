/*
  Warnings:

  - You are about to drop the column `password` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `password_hash` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "password",
DROP COLUMN "password_hash",
ADD COLUMN     "nostr_event" JSONB;
