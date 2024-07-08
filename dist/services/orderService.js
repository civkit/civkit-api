var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { postHoldinvoice, postFullAmountInvoice, handleFiatReceived } from './invoiceService.js';
import { pool } from '../config/db.js';
import { config } from 'dotenv';
config();
/**
 * Add a new order and generate an invoice.
 * @param {Object} orderData - The data for the order including additional fields.
 * @returns {Promise<Object>} - The created order and invoice data.
 */
function addOrderAndGenerateInvoice(orderData) {
    return __awaiter(this, void 0, void 0, function* () {
        const { customer_id, order_details, amount_msat, currency, payment_method, status, type, premium } = orderData;
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            // Insert the order into the database
            const orderInsertText = `
            INSERT INTO orders (customer_id, order_details, amount_msat, currency, payment_method, status, type, premium, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *;
        `;
            const orderResult = yield client.query(orderInsertText, [customer_id, order_details, amount_msat, currency, payment_method, status, type, premium]);
            const order = orderResult.rows[0];
            // Post the hold invoice for 5%
            const holdInvoiceData = yield postHoldinvoice(amount_msat, `Hold Invoice for Order ${order.order_id}`, order_details);
            // Save hold invoice data to the database
            const holdInvoiceInsertText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'hold')
            RETURNING *;
        `;
            yield client.query(holdInvoiceInsertText, [order.order_id, holdInvoiceData.bolt11, amount_msat, holdInvoiceData.status, order_details, holdInvoiceData.payment_hash]);
            // Post the full amount invoice for type 1
            let fullInvoiceData = null;
            if (type === 1) {
                fullInvoiceData = yield postFullAmountInvoice(amount_msat, `Full Amount Invoice for Order ${order.order_id}`, order_details, order.order_id, type);
                // Save full amount invoice data to the database
                const fullInvoiceInsertText = `
                INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'full')
                RETURNING *;
            `;
                yield client.query(fullInvoiceInsertText, [order.order_id, fullInvoiceData.bolt11, amount_msat, fullInvoiceData.status, order_details, fullInvoiceData.payment_hash]);
            }
            yield client.query('COMMIT');
            return { order, holdInvoice: holdInvoiceData, fullAmountInvoice: fullInvoiceData };
        }
        catch (error) {
            yield client.query('ROLLBACK');
            console.error('Transaction failed:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function processTakeOrder(orderId, holdInvoice) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            // Validate hold invoice
            // Update the order to mark as taken
            const updateOrderText = `
          UPDATE orders
          SET status = 'depositing'
          WHERE order_id = $1
          RETURNING *;
        `;
            const updateResult = yield client.query(updateOrderText, [orderId]);
            const updatedOrder = updateResult.rows[0];
            yield client.query('COMMIT');
            return { message: "deposit in progress", order: updatedOrder };
        }
        catch (error) {
            yield client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function generateTakerInvoice(orderId, takerDetails) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            // Retrieve the order type and amount from orders table
            const orderTypeQuery = `SELECT type, amount_msat FROM orders WHERE order_id = $1`;
            const orderTypeResult = yield client.query(orderTypeQuery, [orderId]);
            if (orderTypeResult.rows.length === 0) {
                throw new Error('No order found for this order ID');
            }
            const order = orderTypeResult.rows[0];
            const orderType = order.type;
            const orderAmountMsat = order.amount_msat;
            let invoiceAmountMsat;
            if (orderType === 0) {
                // Use the full order amount for type 0
                invoiceAmountMsat = orderAmountMsat;
            }
            else {
                // Retrieve the original amount from invoices table for type 1
                const orderDetailsQuery = `SELECT amount_msat FROM invoices WHERE order_id = $1 AND invoice_type = 'full'`;
                const orderDetailsResult = yield client.query(orderDetailsQuery, [orderId]);
                if (orderDetailsResult.rows.length === 0) {
                    throw new Error('No full amount invoice found for this order ID');
                }
                const orderDetails = orderDetailsResult.rows[0];
                const amountPercentage = 0.05; // 5% of the amount_msat
                invoiceAmountMsat = Math.round(orderDetails.amount_msat * amountPercentage);
            }
            // Generate hold invoice
            const holdInvoiceData = yield postHoldinvoice(invoiceAmountMsat, `Order ${orderId} for Taker`, takerDetails.description);
            // Insert hold invoice into the database
            const insertHoldInvoiceText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'hold', 'taker')
            RETURNING *;
        `;
            const holdInvoiceResult = yield client.query(insertHoldInvoiceText, [orderId, holdInvoiceData.bolt11, invoiceAmountMsat, holdInvoiceData.description, holdInvoiceData.payment_hash]);
            let fullInvoiceData = null;
            if (orderType === 0) {
                // Generate full invoice for order type 0
                fullInvoiceData = yield postFullAmountInvoice(orderAmountMsat, `Order ${orderId} Full Amount`, takerDetails.description, orderId, orderType);
                if (!fullInvoiceData || !fullInvoiceData.bolt11) {
                    throw new Error('Failed to generate full amount invoice');
                }
                // Insert full invoice into the database
                const insertFullInvoiceText = `
                INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
                VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'full', 'taker')
                RETURNING *;
            `;
                yield client.query(insertFullInvoiceText, [orderId, fullInvoiceData.bolt11, orderAmountMsat, fullInvoiceData.description, fullInvoiceData.payment_hash]);
            }
            yield client.query('COMMIT');
            return { holdInvoice: holdInvoiceResult.rows[0], fullInvoice: fullInvoiceData };
        }
        catch (error) {
            yield client.query('ROLLBACK');
            console.error('Error in generateTakerInvoice:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
// Monitoring and updating the status
function checkAndUpdateOrderStatus(orderId, payment_hash) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            client.query('BEGIN');
            // @ts-expect-error TS(2304): Cannot find name 'queryInvoiceStatus'.
            const checkInvoiceStatus = yield queryInvoiceStatus(payment_hash); // Assume this function checks the payment status
            if (checkInvoiceStatus === 'paid') {
                const updateOrderText = `
                UPDATE orders
                SET status = 'bonds_locked'
                WHERE order_id = $1
                RETURNING *;
            `;
                const result = yield client.query(updateOrderText, [orderId]);
                client.query('COMMIT');
                return result.rows[0];
            }
            client.query('ROLLBACK');
        }
        catch (error) {
            client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function handleFiatReceivedAndUpdateOrder(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield handleFiatReceived(orderId);
            console.log("Order status updated to indicate fiat received.");
        }
        catch (error) {
            console.error("Error updating order status:", error);
            throw error;
        }
    });
}
function updatePayoutStatus(orderId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        const db = yield import('../config/db.js'); // Import the database module dynamically
        try {
            // Update the status of the payout in the payouts table
            const result = yield db.query('UPDATE payouts SET status = $1 WHERE order_id = $2 RETURNING *', [status, orderId]);
            // Check if the payout was updated successfully
            if (result.rows.length === 0) {
                throw new Error('Failed to update payout status');
            }
            return result.rows[0];
        }
        catch (error) {
            throw error;
        }
    });
}
export { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus, handleFiatReceivedAndUpdateOrder, updatePayoutStatus };
