import { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';
import { pool } from '../config/db.js';
import { prisma } from '../config/db.js';  // Import Prisma client

//
export async function createOrder(req, res) {
    console.log('Entering createOrder function');
    try {
        const customer_id = req.user.id;
        console.log('Customer ID:', customer_id);
        
        const orderData = { ...req.body, customer_id };
        console.log('Order data to be processed:', orderData);
        
        const result = await addOrderAndGenerateInvoice(orderData);
        console.log('Order creation result:', result);
        
        res.status(201).json(result);
    } catch (error) {
        console.error('Error in createOrder:', error);
        res.status(500).json({ error: error.message || 'An unexpected error occurred' });
    }
}

export async function takeOrder(req, res) {
    const { orderId, takerDetails } = req.body;
    const customer_id = req.user.id; // Extract customer ID from authenticated user

    try {
        // Generate hold invoice for the taker
        const invoice = await generateTakerInvoice(orderId, takerDetails, customer_id);

        // Update the taker_customer_id in the orders table using Prisma
        await prisma.order.update({
            where: { order_id: orderId },
            data: { taker_customer_id: customer_id }
        });

        res.status(201).json({ message: "Invoice generated for taker", invoice });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function checkInvoicePayment(req: any, res: any) {
    const { orderId, payment_hash } = req.body;
    try {
        const order = await checkAndUpdateOrderStatus(orderId, payment_hash);
        res.status(200).json({ message: "Order status updated based on invoice payment", order });
    } catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: error.message });
    }
}
