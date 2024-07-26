import { postHoldinvoice, generateBolt11Invoice, postFullAmountInvoice,  handleFiatReceived } from './invoiceService.js'; 
import { pool } from '../config/db.js'; 
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
config();

/**
 * Add a new order and generate an invoice.
 * @param {Object} orderData - The data for the order including additional fields.
 * @returns {Promise<Object>} - The created order and invoice data.
 */
async function addOrderAndGenerateInvoice(orderData) {
    console.log('Starting addOrderAndGenerateInvoice with data:', orderData);
    const {
        customer_id,
        order_details,
        amount_msat,
        currency,
        payment_method,
        status,
        type,
        premium = 0
    } = orderData;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('Transaction begun');

        // Insert the order into the database
        const orderInsertText = `
            INSERT INTO orders (customer_id, order_details, amount_msat, currency, payment_method, status, type, premium, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *;
        `;
        const orderResult = await client.query(orderInsertText, [customer_id, order_details, amount_msat, currency, payment_method, status, type, premium]);
        const order = orderResult.rows[0];
        console.log('Order inserted:', order);

        // Post the hold invoice
        console.log('Generating hold invoice');
        const holdInvoiceData = await postHoldinvoice(amount_msat, `Hold Invoice for Order ${order.order_id}`, order_details);
        console.log('Hold invoice generated:', holdInvoiceData);

        // Check if holdInvoiceData contains the necessary fields
        if (!holdInvoiceData || !holdInvoiceData.bolt11 || !holdInvoiceData.payment_hash) {
            throw new Error('Invalid hold invoice data received: ' + JSON.stringify(holdInvoiceData));
        }

        // Save hold invoice data to the database
        const holdInvoiceInsertText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'hold')
            RETURNING *;
        `;
        const holdInvoiceResult = await client.query(holdInvoiceInsertText, [
            order.order_id, 
            holdInvoiceData.bolt11, 
            amount_msat, 
            holdInvoiceData.status || 'pending', 
            order_details, 
            holdInvoiceData.payment_hash
        ]);
        console.log('Hold invoice saved to database:', holdInvoiceResult.rows[0]);

        let fullInvoiceData = null;
        if (type === 1) { // For sell orders
            console.log('Generating full invoice for sell order');
            fullInvoiceData = await postFullAmountInvoice(amount_msat, `Full Invoice for Order ${order.order_id}`, order_details, order.order_id, type);
            
            if (!fullInvoiceData || !fullInvoiceData.bolt11) {
                throw new Error('Failed to generate full amount invoice');
            }

            // Save full invoice data to the database
            const fullInvoiceInsertText = `
                INSERT INTO invoices (order_id, bolt11, amount_msat, status, description, payment_hash, created_at, expires_at, invoice_type)
                VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY', 'full')
                RETURNING *;
            `;
            const fullInvoiceResult = await client.query(fullInvoiceInsertText, [
                order.order_id, 
                fullInvoiceData.bolt11, 
                amount_msat, 
                'pending', 
                order_details, 
                fullInvoiceData.payment_hash
            ]);
            console.log('Full invoice saved to database:', fullInvoiceResult.rows[0]);
        }

        await client.query('COMMIT');
        console.log('Transaction committed');
        return { order, holdInvoice: holdInvoiceData, fullInvoice: fullInvoiceData };
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

async function generateTakerInvoice(orderId, takerDetails, customer_id) {
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

        // Generate hold invoice for 5% of the order amount
        const holdInvoiceAmount = Math.round(orderAmountMsat * 0.05);
        console.log(`Generating hold invoice for order ${orderId} with amount ${holdInvoiceAmount} msat`);
        const holdInvoiceData = await postHoldinvoice(holdInvoiceAmount, `Order ${orderId} for Taker`, takerDetails.description);
        
        // Insert hold invoice into the database
        const insertHoldInvoiceText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'hold', 'taker')
            RETURNING *;
        `;
        const holdInvoiceResult = await client.query(insertHoldInvoiceText, [orderId, holdInvoiceData.bolt11, holdInvoiceAmount, holdInvoiceData.description, holdInvoiceData.payment_hash]);
        
        let fullInvoiceData = null;
        if (orderType === 1) { // For sell orders
            try {
                console.log(`Generating full invoice for sell order ${orderId} with amount ${orderAmountMsat} msat`);
                fullInvoiceData = await postFullAmountInvoice(orderAmountMsat, `Order ${orderId} Full Amount`, takerDetails.description, orderId, orderType);

                if (!fullInvoiceData || !fullInvoiceData.bolt11) {
                    throw new Error('Failed to generate full amount invoice: Invalid response data');
                }

                // Insert full invoice into the database
                const insertFullInvoiceText = `
                    INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type, user_type)
                    VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'full', 'taker')
                    RETURNING *;
                `;
                const fullInvoiceResult = await client.query(insertFullInvoiceText, [orderId, fullInvoiceData.bolt11, orderAmountMsat, fullInvoiceData.description, fullInvoiceData.payment_hash]);
                fullInvoiceData = fullInvoiceResult.rows[0];
                console.log(`Full invoice inserted into database for order ${orderId}:`, fullInvoiceData);
            } catch (error) {
                console.error(`Error generating full invoice for order ${orderId}:`, error);
                throw error;
            }
        }

        // Update the order status and taker_customer_id
        const updateOrderText = `
            UPDATE orders
            SET status = 'depositing', taker_customer_id = $1
            WHERE order_id = $2
            RETURNING *;
        `;
        const updatedOrderResult = await client.query(updateOrderText, [customer_id, orderId]);

        await client.query('COMMIT');
        return { 
            order: updatedOrderResult.rows[0],
            holdInvoice: holdInvoiceResult.rows[0], 
            fullInvoice: fullInvoiceData 
        };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in generateTakerInvoice:', error);
        throw error;
    } finally {
        client.release();
    }
}


// Monitoring and updating the status
async function checkAndUpdateOrderStatus(orderId, payment_hash) {
    try {
      const checkInvoiceStatus = await queryInvoiceStatus(payment_hash);
      if (checkInvoiceStatus === 'paid') {
        const updatedOrder = await prisma.orders.update({
          where: { order_id: parseInt(orderId) },
          data: { status: 'bonds_locked' },
        });
        return updatedOrder;
      }
    } catch (error) {
      console.error('Error in checkAndUpdateOrderStatus:', error);
      throw error;
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
