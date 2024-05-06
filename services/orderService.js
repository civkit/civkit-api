import { postHoldinvoice, generateBolt11Invoice } from './invoiceService.js'; // Ensure this import matches your project's structure
import { pool } from '../config/db.js'; // Updated to use named imports

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
        currency,        // New column
        payment_method,  // New column
        status           // New column
    } = orderData;
    
    const client = await pool.connect(); // Directly use pool for database operations
    
    try {
        await client.query('BEGIN');
    
        // Insert the new order into the database
        const orderInsertText = `
          INSERT INTO orders (customer_id, order_details, amount_msat, currency, payment_method, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          RETURNING *;
        `;
        const orderResult = await client.query(orderInsertText, [customer_id, order_details, amount_msat, currency, payment_method, status]);
        const order = orderResult.rows[0];
    
        // Generate a hold invoice using the invoice service
        const invoiceData = await postHoldinvoice(amount_msat, `Order ${order.order_id}`, order_details);
        
        // Insert the generated invoice into the invoices table
        const invoiceInsertText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY')
            RETURNING *;
        `;
        const invoiceResult = await client.query(invoiceInsertText, [order.order_id, invoiceData.bolt11, amount_msat, order_details, invoiceData.payment_hash]);
        const invoice = invoiceResult.rows[0];
        

        await client.query('COMMIT');
        return { order, invoice }; // Return the created order and invoice
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;  // This error will be caught by the Express error handler
    } finally {
        client.release(); // Ensure the database client is released regardless of the outcome
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
    
        const orderDetailsQuery = `SELECT amount_msat FROM invoices WHERE order_id = $1 AND invoice_type = 'maker'`;
        const orderDetailsResult = await client.query(orderDetailsQuery, [orderId]);

        if (orderDetailsResult.rows.length === 0) {
            throw new Error('No maker invoice found for this order ID');
        }

        const orderDetails = orderDetailsResult.rows[0];
        const invoiceData = await generateBolt11Invoice(orderDetails.amount_msat, `Order ${orderId} for Taker`, takerDetails.description);
  
        const insertInvoiceText = `
            INSERT INTO invoices (order_id, bolt11, amount_msat, description, status, payment_hash, created_at, expires_at, invoice_type)
            VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW() + INTERVAL '1 DAY', 'taker')
            RETURNING *;
        `;
        const result = await client.query(insertInvoiceText, [orderId, invoiceData.bolt11, orderDetails.amount_msat, invoiceData.description, invoiceData.payment_hash]);
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

export { addOrderAndGenerateInvoice, processTakeOrder, generateTakerInvoice, checkAndUpdateOrderStatus };
