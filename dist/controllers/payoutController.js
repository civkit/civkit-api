var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createPayout } from '../services/payoutService.js';
function submitPayout(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { order_id, ln_invoice } = req.body;
            const payout = yield createPayout(order_id, ln_invoice);
            res.status(200).json({ success: true, message: 'Payout submitted successfully', data: payout });
        }
        catch (error) {
            console.error('Error submitting payout:', error);
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            res.status(500).json({ success: false, message: 'Failed to submit payout', error: error.message });
        }
    });
}
export { submitPayout };
