import { postHoldinvoice, generateBolt11Invoice, postFullAmountInvoice,  handleFiatReceived } from './invoiceService.js'; // Ensure this import matches your project's structure
import { pool } from '../config/db.js'; // Updated to use named imports
import { config } from 'dotenv';
config(); // Make sure this is called before using process.env variables

/**
 * Add a new order and generate an invoice.
 * @param {Object} orderData - The data for the order including additional fields.
 * @returns {Promise<Object>} - The created order and invoice data.
 */
async function addOrderAndGenerateInvoice(orderData) {
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

async function processTakeOrder(orderId, holdInvoice) {
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

async function generateTakerInvoice(orderId, takerDetails) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
    
        const orderDetailsQuery = `SELECT amount_msat FROM invoices WHERE order_id = $1`;
        const orderDetailsResult = await client.query(orderDetailsQuery, [orderId]);

        if (orderDetailsResult.rows.length === 0) {
            throw new Error('No maker invoice found for this order ID');
        }

        const orderDetails = orderDetailsResult.rows[0];
        
        // Calculate the invoice amount as 5% of the amount in msat
        const invoiceAmountMsat = Math.floor(orderDetails.amount_msat * 0.05);

        const invoiceData = await generateBolt11Invoice(invoiceAmountMsat, `Order ${orderId} for Taker`, takerDetails.description);
  
        const insertInvoiceText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'taker')
            RETURNING *;
        `;
        const result = await client.query(insertInvoiceText, [orderId, invoiceData.bolt11, invoiceAmountMsat, invoiceData.description, invoiceData.payment_hash]);
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}


// Monitoring and updating the status
async function checkAndUpdateOrderStatus(orderId, payment_hash) {
    const client = await pool.connect();
    try {
        client.query('BEGIN');
        
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

async function handleFiatReceivedAndUpdateOrder(orderId) {
    try {
        await handleFiatReceived(orderId);
        console.log("Order status updated to indicate fiat received.");
    } catch (error) {
        console.error("Error updating order status:", error);
        throw error;
    }
}

async function updatePayoutStatus(orderId, status) {
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
