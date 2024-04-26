import { postHoldinvoice } from './invoiceService.js'; // Ensure this import matches your project's structure
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
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '1 DAY')
            RETURNING *;
        `;
        const invoiceResult = await client.query(invoiceInsertText, [order.order_id, invoiceData.bolt11, amount_msat, order_details, 'pending', invoiceData.payment_hash]);
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

export { addOrderAndGenerateInvoice };
