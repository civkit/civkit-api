import { createPayout } from '../services/payoutService.js';

async function submitPayout(req, res) {
    try {
        const { order_id, ln_invoice } = req.body;
        const payout = await createPayout(order_id, ln_invoice);
        res.json({ success: true, message: 'Payout submitted successfully', data: payout });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

export { submitPayout };
