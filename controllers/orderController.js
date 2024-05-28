// controllers/orderController.js
import { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';

export async function createOrder(req, res) {
    try {
        const customer_id = req.user.id;  // Extract customer_id from logged-in user
        const orderData = { ...req.body, customer_id };  // Include customer_id in order data
        const result = await addOrderAndGenerateInvoice(orderData);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function takeOrder(req, res) {
    const { orderId, takerDetails } = req.body;
    const customer_id = req.user.id; // Extract customer ID from authenticated user

    try {
        // Generate hold invoice for the taker
        const invoice = await generateTakerInvoice(orderId, takerDetails, customer_id); // Pass customer_id
        res.status(201).json({ message: "Invoice generated for taker", invoice });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function checkInvoicePayment(req, res) {
    const { orderId, payment_hash } = req.body;
    try {
        const order = await checkAndUpdateOrderStatus(orderId, payment_hash);
        res.status(200).json({ message: "Order status updated based on invoice payment", order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
