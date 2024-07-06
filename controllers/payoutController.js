import { createPayout } from '../services/payoutService.js';

async function submitPayout(req, res) {
    try {
        const { order_id, ln_invoice } = req.body;
        const payout = await createPayout(order_id, ln_invoice);
        res.status(200).json({ success: true, message: 'Payout submitted successfully', data: payout });
    } catch (error) {
        console.error('Error submitting payout:', error);
        res.status(500).json({ success: false, message: 'Failed to submit payout', error: error.message });
    }
}

export { submitPayout };

