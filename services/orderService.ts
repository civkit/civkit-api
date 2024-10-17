import { postHoldinvoice, generateBolt11Invoice, postFullAmountInvoice, handleFiatReceived } from './invoiceService.js';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config();
const prisma = new PrismaClient();

export async function addOrderAndGenerateInvoice(orderData: OrderData): Promise<{ order: Order; invoice: Invoice }> {
  console.log('Starting addOrderAndGenerateInvoice with data:', orderData);

  const order = await prisma.order.create({
    data: orderData,
  });

  console.log('Order inserted:', order);

  if (!order || !order.order_id) {
    console.error('Failed to create order or get order_id');
    throw new Error('Failed to create order');
  }

  console.log('Generating hold invoice');
  const invoice = await postHoldinvoice(
    order.amount_msat,
    order.order_details,
    order.order_id,
    orderData.type === 0 ? 'maker' : 'taker'
  );

  console.log('Hold invoice generated:', invoice);

  return { order, invoice };
}

async function processTakeOrder(orderId: number, holdInvoice: any) {
    try {
        // Update the order to mark as taken
        const updatedOrder = await prisma.order.update({
            where: { order_id: orderId },
            data: { status: 'depositing' }
        });

        return { message: "deposit in progress", order: updatedOrder };
    } catch (error) {
        throw error;
    }
}

async function generateTakerInvoice(orderId: number, takerDetails: any, customer_id: number) {
    try {
        // Retrieve the order type and amount from orders table
        const order = await prisma.order.findUnique({
            where: { order_id: orderId }
        });

        if (!order) {
            throw new Error('No order found for this order ID');
        }

        const orderType = order.type;
        const orderAmountMsat = order.amount_msat;

        // Generate hold invoice for 5% of the order amount
        const holdInvoiceAmount = Math.round(orderAmountMsat * 0.05);
        console.log(`Generating hold invoice for order ${orderId} with amount ${holdInvoiceAmount} msat`);
        const holdInvoiceData = await postHoldinvoice(holdInvoiceAmount, `Order ${orderId} for Taker`, takerDetails.description);
        
        // Insert hold invoice into the database
        const holdInvoice = await prisma.invoice.create({
            data: {
                order_id: orderId,
                bolt11: holdInvoiceData.bolt11,
                amount_msat: holdInvoiceAmount,
                description: holdInvoiceData.description,
                status: 'pending',
                payment_hash: holdInvoiceData.payment_hash,
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
                invoice_type: 'hold',
                user_type: 'taker'
            }
        });
        
        let fullInvoiceData = null;
        if (orderType === 1) { // For sell orders
            try {
                console.log(`Generating full invoice for sell order ${orderId} with amount ${orderAmountMsat} msat`);
                fullInvoiceData = await postFullAmountInvoice(orderAmountMsat, `Order ${orderId} Full Amount`, takerDetails.description, orderId, orderType);

                if (!fullInvoiceData || !fullInvoiceData.bolt11) {
                    throw new Error('Failed to generate full amount invoice: Invalid response data');
                }

                // Insert full invoice into the database
                fullInvoiceData = await prisma.invoice.create({
                    data: {
                        order_id: orderId,
                        bolt11: fullInvoiceData.bolt11,
                        amount_msat: orderAmountMsat,
                        description: fullInvoiceData.description,
                        status: 'pending',
                        payment_hash: fullInvoiceData.payment_hash,
                        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
                        invoice_type: 'full',
                        user_type: 'taker'
                    }
                });
                console.log(`Full invoice inserted into database for order ${orderId}:`, fullInvoiceData);
            } catch (error) {
                console.error(`Error generating full invoice for order ${orderId}:`, error);
                throw error;
            }
        }

        // Update the order status and taker_customer_id
        const updatedOrder = await prisma.order.update({
            where: { order_id: orderId },
            data: {
                status: 'depositing',
                taker_customer_id: customer_id
            }
        });

        return { 
            order: updatedOrder,
            holdInvoice, 
            fullInvoice: fullInvoiceData 
        };
    } catch (error) {
        console.error('Error in generateTakerInvoice:', error);
        throw error;
    }
}

async function checkAndUpdateOrderStatus(orderId: number, payment_hash: string) {
    try {
        const checkInvoiceStatus = await queryInvoiceStatus(payment_hash);
        if (checkInvoiceStatus === 'paid') {
            const updatedOrder = await prisma.order.update({
                where: { order_id: orderId },
                data: { status: 'bonds_locked' },
            });
            return updatedOrder;
        }
    } catch (error) {
        console.error('Error in checkAndUpdateOrderStatus:', error);
        throw error;
    }
}

async function handleFiatReceivedAndUpdateOrder(orderId: number) {
    try {
        await handleFiatReceived(orderId);
        console.log("Order status updated to indicate fiat received.");
    } catch (error) {
        console.error("Error updating order status:", error);
        throw error;
    }
}

async function updatePayoutStatus(orderId: number, status: string) {
    try {
        const updatedPayout = await prisma.payout.updateMany({
            where: { order_id: orderId },
            data: { status }
        });

        if (updatedPayout.count === 0) {
            throw new Error('Failed to update payout status');
        }

        return updatedPayout;
    } catch (error) {
        throw error;
    }
}

export { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus, handleFiatReceivedAndUpdateOrder, updatePayoutStatus };
