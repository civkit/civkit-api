import { addOrderAndGenerateInvoice, processTakeOrder } from '../services/orderService.js';
import { generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';

export async function createOrder(req, res) {
    try {
        const result = await addOrderAndGenerateInvoice(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}


export async function takeOrder(req, res) {
    const { orderId, takerDetails } = req.body;
    try {
        // Generate hold invoice for the taker
        const invoice = await generateTakerInvoice(orderId, takerDetails);
        // Optionally, update order status here if needed, or wait for invoice payment confirmation
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