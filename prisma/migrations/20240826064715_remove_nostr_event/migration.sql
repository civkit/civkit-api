/*
  Warnings:

  - You are about to drop the column `nostr_event` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "nostr_event";
