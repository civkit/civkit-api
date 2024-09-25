/*
  Warnings:

  - A unique constraint covering the columns `[order_id,user_type,invoice_type,status]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "invoices_order_id_user_type_invoice_type_status_key" ON "invoices"("order_id", "user_type", "invoice_type", "status");
