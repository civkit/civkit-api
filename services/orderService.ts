import { postHoldinvoice, generateBolt11Invoice, postFullAmountInvoice,  handleFiatReceived } from './invoiceService.js'; 
import { pool } from '../config/db.js'; 
import { config } from 'dotenv';
config();

/**
 * Add a new order and generate an invoice.
 * @param {Object} orderData - The data for the order including additional fields.
 * @returns {Promise<Object>} - The created order and invoice data.
 */
async function addOrderAndGenerateInvoice(orderData: any) {
    const {
        customer_id,
        order_details,
        amount_msat,
        currency,
        payment_method,
        status,
        type,
        premium
    } = orderData;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insert the order into the database
        const orderInsertText = `
            INSERT INTO orders (customer_id, order_details, amount_msat, currency, payment_method, status, type, premium, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *;
        `;
        const orderResult = await client.query(orderInsertText, [customer_id, order_details, amount_msat, currency, payment_method, status, type, premium]);
        const order = orderResult.rows[0];

        // Post the hold invoice for 5%
        const holdInvoiceData = await postHoldinvoice(amount_msat, `Hold Invoice for Order ${order.order_id}`, order_details);

        // Save hold invoice data to the database
        const holdInvoiceInsertText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'hold')
            RETURNING *;
        `;
        await client.query(holdInvoiceInsertText, [order.order_id, holdInvoiceData.bolt11, amount_msat, holdInvoiceData.status, order_details, holdInvoiceData.payment_hash]);

        // Post the full amount invoice for type 1
        let fullInvoiceData = null;
        if (type === 1) {
            fullInvoiceData = await postFullAmountInvoice(amount_msat, `Full Amount Invoice for Order ${order.order_id}`, order_details, order.order_id, type);
            
            // Save full amount invoice data to the database
            const fullInvoiceInsertText = `
                INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'full')
                RETURNING *;
            `;
            await client.query(fullInvoiceInsertText, [order.order_id, fullInvoiceData.bolt11, amount_msat, fullInvoiceData.status, order_details, fullInvoiceData.payment_hash]);
        }

        await client.query('COMMIT');
        return { order, holdInvoice: holdInvoiceData, fullAmountInvoice: fullInvoiceData };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function processTakeOrder(orderId: any, holdInvoice: any) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Validate hold invoice

        // Update the order to mark as taken
        const updateOrderText = `
          UPDATE orders
          SET status = 'depositing'
          WHERE order_id = $1
          RETURNING *;
        `;
        const updateResult = await client.query(updateOrderText, [orderId]);
        const updatedOrder = updateResult.rows[0];

        await client.query('COMMIT');
        return { message: "deposit in progress", order: updatedOrder };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function generateTakerInvoice(orderId: any, takerDetails: any) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Retrieve the order type and amount from orders table
        const orderTypeQuery = `SELECT type, amount_msat FROM orders WHERE order_id = $1`;
        const orderTypeResult = await client.query(orderTypeQuery, [orderId]);
        
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
        } else {
            // Retrieve the original amount from invoices table for type 1
            const orderDetailsQuery = `SELECT amount_msat FROM invoices WHERE order_id = $1 AND invoice_type = 'full'`;
            const orderDetailsResult = await client.query(orderDetailsQuery, [orderId]);

            if (orderDetailsResult.rows.length === 0) {
                throw new Error('No full amount invoice found for this order ID');
            }

            const orderDetails = orderDetailsResult.rows[0];
            const amountPercentage = 0.05; // 5% of the amount_msat
            invoiceAmountMsat = Math.round(orderDetails.amount_msat * amountPercentage);
        }

        // Generate hold invoice
        const holdInvoiceData = await postHoldinvoice(invoiceAmountMsat, `Order ${orderId} for Taker`, takerDetails.description);
        
        // Insert hold invoice into the database
        const insertHoldInvoiceText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'hold', 'taker')
            RETURNING *;
        `;
        const holdInvoiceResult = await client.query(insertHoldInvoiceText, [orderId, holdInvoiceData.bolt11, invoiceAmountMsat, holdInvoiceData.description, holdInvoiceData.payment_hash]);
        
        let fullInvoiceData = null;
        if (orderType === 0) {
            // Generate full invoice for order type 0
            fullInvoiceData = await postFullAmountInvoice(orderAmountMsat, `Order ${orderId} Full Amount`, takerDetails.description, orderId, orderType);

            if (!fullInvoiceData || !fullInvoiceData.bolt11) {
                throw new Error('Failed to generate full amount invoice');
            }

            // Insert full invoice into the database
            const insertFullInvoiceText = `
                INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
                VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'full', 'taker')
                RETURNING *;
            `;
            await client.query(insertFullInvoiceText, [orderId, fullInvoiceData.bolt11, orderAmountMsat, fullInvoiceData.description, fullInvoiceData.payment_hash]);
        }

        await client.query('COMMIT');
        return { holdInvoice: holdInvoiceResult.rows[0], fullInvoice: fullInvoiceData };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in generateTakerInvoice:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Monitoring and updating the status
async function checkAndUpdateOrderStatus(orderId: any, payment_hash: any) {
    const client = await pool.connect();
    try {
        client.query('BEGIN');
        
        // @ts-expect-error TS(2304): Cannot find name 'queryInvoiceStatus'.
        const checkInvoiceStatus = await queryInvoiceStatus(payment_hash); // Assume this function checks the payment status
        if (checkInvoiceStatus === 'paid') {
            const updateOrderText = `
                UPDATE orders
                SET status = 'bonds_locked'
                WHERE order_id = $1
                RETURNING *;
            `;
            const result = await client.query(updateOrderText, [orderId]);
            client.query('COMMIT');
            return result.rows[0];
        }
        client.query('ROLLBACK');
    } catch (error) {
        client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function handleFiatReceivedAndUpdateOrder(orderId: any) {
    try {
        await handleFiatReceived(orderId);
        console.log("Order status updated to indicate fiat received.");
    } catch (error) {
        console.error("Error updating order status:", error);
        throw error;
    }
}

async function updatePayoutStatus(orderId: any, status: any) {
    const db = await import('../config/db.js'); // Import the database module dynamically

    try {
        // Update the status of the payout in the payouts table
        const result = await db.query('UPDATE payouts SET status = $1 WHERE order_id = $2 RETURNING *', [status, orderId]);

        // Check if the payout was updated successfully
        if (result.rows.length === 0) {
            throw new Error('Failed to update payout status');
        }

        return result.rows[0];
    } catch (error) {
        throw error;
    }
}


export { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus, handleFiatReceivedAndUpdateOrder , updatePayoutStatus};
