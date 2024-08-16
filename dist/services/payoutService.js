var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
config();
const prisma = new PrismaClient();
function createPayout(order_id_1, ln_invoice_1) {
    return __awaiter(this, arguments, void 0, function* (order_id, ln_invoice, status = 'pending') {
        try {
            // Validate order_id, check if it exists and is eligible for payout
            const order = yield prisma.order.findUnique({
                where: { order_id: order_id }
            });
            if (!order) {
                throw new Error('Order does not exist or is not eligible for payout.');
            }
            // Insert the payout information into the payouts table
            const payout = yield prisma.payout.create({
                data: {
                    order_id: order_id,
                    ln_invoice: ln_invoice,
                    status: status
                }
            });
            return payout;
        }
        catch (error) {
            throw error;
        }
    });
}
function retrievePayoutInvoice(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Retrieve the payout invoice from the database based on the order ID
            const payout = yield prisma.payout.findFirst({
                where: { order_id: orderId },
                select: { ln_invoice: true }
            });
            // Check if a payout invoice exists for the order ID
            if (!payout) {
                throw new Error('No payout invoice found for this order ID');
            }
            return payout.ln_invoice;
        }
        catch (error) {
            throw error;
        }
    });
}
export { createPayout, retrievePayoutInvoice };
