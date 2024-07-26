var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { addOrderAndGenerateInvoice, generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';
import { pool } from '../config/db.js';
//
export function createOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Entering createOrder function');
        try {
            const customer_id = req.user.id;
            console.log('Customer ID:', customer_id);
            const orderData = Object.assign(Object.assign({}, req.body), { customer_id });
            console.log('Order data to be processed:', orderData);
            const result = yield addOrderAndGenerateInvoice(orderData);
            console.log('Order creation result:', result);
            res.status(201).json(result);
        }
        catch (error) {
            console.error('Error in createOrder:', error);
            res.status(500).json({ error: error.message || 'An unexpected error occurred' });
        }
    });
}
export function takeOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { orderId, takerDetails } = req.body;
        const customer_id = req.user.id; // Extract customer ID from authenticated user
        try {
            // Generate hold invoice for the taker
            // @ts-expect-error TS(2554): Expected 2 arguments, but got 3.
            const invoice = yield generateTakerInvoice(orderId, takerDetails, customer_id); // Pass customer_id
            // Update the taker_customer_id in the orders table
            const client = yield pool.connect();
            try {
                yield client.query('BEGIN');
                const updateQuery = `
                UPDATE orders
                SET taker_customer_id = $1
                WHERE order_id = $2
            `;
                yield client.query(updateQuery, [customer_id, orderId]);
                yield client.query('COMMIT');
            }
            catch (err) {
                yield client.query('ROLLBACK');
                throw err;
            }
            finally {
                client.release();
            }
            res.status(201).json({ message: "Invoice generated for taker", invoice });
        }
        catch (error) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            res.status(500).json({ error: error.message });
        }
    });
}
export function checkInvoicePayment(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { orderId, payment_hash } = req.body;
        try {
            const order = yield checkAndUpdateOrderStatus(orderId, payment_hash);
            res.status(200).json({ message: "Order status updated based on invoice payment", order });
        }
        catch (error) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            res.status(500).json({ error: error.message });
        }
    });
}
