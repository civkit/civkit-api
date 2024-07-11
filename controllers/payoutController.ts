import { createPayout } from '../services/payoutService.js';

async function submitPayout(req: any, res: any) {
    try {
        const { order_id, ln_invoice } = req.body;
        const payout = await createPayout(order_id, ln_invoice);
        res.status(200).json({ success: true, message: 'Payout submitted successfully', data: payout });
    } catch (error) {
        console.error('Error submitting payout:', error);
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ success: false, message: 'Failed to submit payout', error: error.message });
    }
}

export { submitPayout };

