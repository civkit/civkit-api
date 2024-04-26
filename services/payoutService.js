async function createPayout(order_id, ln_invoice) {
    const db = await import('../config/db.js');  // Dynamically import the CommonJS module

    // Validate order_id, check if it exists and is eligible for payout
    const order = await db.query('SELECT * FROM orders WHERE order_id = $1', [order_id]);
    if (order.rows.length === 0) {
        throw new Error('Order does not exist or is not eligible for payout.');
    }

    // Insert the payout information into the payouts table
    const result = await db.query('INSERT INTO payouts (order_id, ln_invoice, status) VALUES ($1, $2, $3) RETURNING *', [order_id, ln_invoice, 'pending']);
    return result.rows[0];
}

export { createPayout };
