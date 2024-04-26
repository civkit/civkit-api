import { addOrderAndGenerateInvoice } from '../services/orderService.js';

export async function createOrder(req, res) {
    try {
        const result = await addOrderAndGenerateInvoice(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
