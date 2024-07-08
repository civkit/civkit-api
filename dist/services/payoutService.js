var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { config } from 'dotenv';
config();
function createPayout(order_id_1, ln_invoice_1) {
    return __awaiter(this, arguments, void 0, function* (order_id, ln_invoice, status = 'pending') {
        const db = yield import('../config/db.js');
        // Validate order_id, check if it exists and is eligible for payout
        const order = yield db.query('SELECT * FROM orders WHERE order_id = $1', [order_id]);
        if (order.rows.length === 0) {
            throw new Error('Order does not exist or is not eligible for payout.');
        }
        // Insert the payout information into the payouts table
        const result = yield db.query('INSERT INTO payouts (order_id, ln_invoice, status) VALUES ($1, $2, $3) RETURNING *', [order_id, ln_invoice, status]);
        return result.rows[0];
    });
}
function retrievePayoutInvoice(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const db = yield import('../config/db.js');
        try {
            // Retrieve the payout invoice from the database based on the order ID
            const result = yield db.query('SELECT ln_invoice FROM payouts WHERE order_id = $1', [orderId]);
            // Check if a payout invoice exists for the order ID
            if (result.rows.length === 0) {
                throw new Error('No payout invoice found for this order ID');
            }
            // Extract the Lightning invoice from the database result
            // @ts-expect-error TS(2339): Property 'ln_invoice' does not exist on type 'any[... Remove this comment to see the full error message
            const ln_invoice = result.rows[0].ln_invoice;
            return ln_invoice;
        }
        catch (error) {
            throw error;
        }
    });
}
export { createPayout, retrievePayoutInvoice };
