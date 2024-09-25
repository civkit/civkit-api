import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

async function createPayout(order_id: number, ln_invoice: string, status = 'pending') {
    try {
        // Validate order_id, check if it exists and is eligible for payout
        const order = await prisma.order.findUnique({
            where: { order_id: order_id }
        });

        if (!order) {
            throw new Error('Order does not exist or is not eligible for payout.');
        }

        // Insert the payout information into the payouts table
        const payout = await prisma.payout.create({
            data: {
                order_id: order_id,
                ln_invoice: ln_invoice,
                status: status
            }
        });

        return payout;
    } catch (error) {
        throw error;
    }
}

async function retrievePayoutInvoice(orderId: number) {
    try {
        // Retrieve the payout invoice from the database based on the order ID
        const payout = await prisma.payout.findFirst({
            where: { order_id: orderId },
            select: { ln_invoice: true }
        });

        // Check if a payout invoice exists for the order ID
        if (!payout) {
            throw new Error('No payout invoice found for this order ID');
        }

        return payout.ln_invoice;
    } catch (error) {
        throw error;
    }
}

export { createPayout, retrievePayoutInvoice };