import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

async function createPayout(orderId: number, lnInvoice: string) {
  try {
    // Fetch the order
    const order = await prisma.order.findUnique({
      where: { order_id: orderId },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Create the payout record without amount_msat
    const payout = await prisma.payout.create({
      data: {
        order_id: orderId,
        ln_invoice: lnInvoice,
        status: 'pending',
      },
    });

    return payout;
  } catch (error) {
    console.error('Error in createPayout:', error);
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
