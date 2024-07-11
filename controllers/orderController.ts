import { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';
import { pool } from '../config/db.js';

//
export async function createOrder(req: any, res: any) {
    try {
        const customer_id = req.user.id;  // Extract customer_id from logged-in user
        const orderData = { ...req.body, customer_id };  // Include customer_id in order data
        const result = await addOrderAndGenerateInvoice(orderData);
        res.status(201).json(result);
    } catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: error.message });
    }
}

export async function takeOrder(req: any, res: any) {
    const { orderId, takerDetails } = req.body;
    const customer_id = req.user.id; // Extract customer ID from authenticated user

    try {
        // Generate hold invoice for the taker
        // @ts-expect-error TS(2554): Expected 2 arguments, but got 3.
        const invoice = await generateTakerInvoice(orderId, takerDetails, customer_id); // Pass customer_id

        // Update the taker_customer_id in the orders table
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const updateQuery = `
                UPDATE orders
                SET taker_customer_id = $1
                WHERE order_id = $2
            `;
            await client.query(updateQuery, [customer_id, orderId]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        res.status(201).json({ message: "Invoice generated for taker", invoice });
    } catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
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
