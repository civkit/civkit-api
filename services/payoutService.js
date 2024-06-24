import { config } from 'dotenv';
config();

async function createPayout(order_id, ln_invoice, status = 'pending') {
    const db = await import('../config/db.js'); 

    // Validate order_id, check if it exists and is eligible for payout
    const order = await db.query('SELECT * FROM orders WHERE order_id = $1', [order_id]);
    if (order.rows.length === 0) {
        throw new Error('Order does not exist or is not eligible for payout.');
    }

    // Insert the payout information into the payouts table
    const result = await db.query('INSERT INTO payouts (order_id, ln_invoice, status) VALUES ($1, $2, $3) RETURNING *', [order_id, ln_invoice, status]);
    return result.rows[0];
}


async function retrievePayoutInvoice(orderId) {
    const db = await import('../config/db.js');  

    try {
        // Retrieve the payout invoice from the database based on the order ID
        const result = await db.query('SELECT ln_invoice FROM payouts WHERE order_id = $1', [orderId]);

        // Check if a payout invoice exists for the order ID
        if (result.rows.length === 0) {
            throw new Error('No payout invoice found for this order ID');
        }

        // Extract the Lightning invoice from the database result
        const ln_invoice = result.rows[0].ln_invoice;
        
        return ln_invoice;
    } catch (error) {
        throw error;
    }
}

export { createPayout, retrievePayoutInvoice };


