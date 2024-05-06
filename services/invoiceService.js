// Import statements for ES Modules
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import pkg from 'pg';  // Corrected import for CommonJS module
const { Pool } = pkg;

config(); // This line configures dotenv to load the environment variables

const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const MY_RUNE = process.env.RUNE;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function postHoldinvoice(totalAmountMsat, label, description) {
  const amount_msat = Math.round(totalAmountMsat * 0.05);  // Calculate 5% of the total amount
  const data = {
    amount_msat,
    label,
    description,
    cltv: 770,
  };
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to post invoice:', error);
    throw error;
  }
}
async function holdInvoiceLookup({ state, payment_hash }) {
  try {
    const bodyData = state ? { state } : { payment_hash };
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicelookup`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyData),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const invoiceData = await response.json();
    // Assuming the response is an object with an invoices key
    return invoiceData.invoices || []; // Ensure it always returns an array
  } catch (error) {
    console.error('Failed to lookup invoices:', error);
    throw error;
  }
}


async function syncInvoicesWithNode() {
  const agent = new https.Agent({
    rejectUnauthorized: false  // Reminder: Ensure to handle SSL/TLS certificate verification correctly in production.
  });

  const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Rune': MY_RUNE,
    },
    agent
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  const { invoices } = await response.json();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderUpdates = {}; // Track updated statuses for orders

    for (const invoice of invoices) {
      const res = await client.query(
        'SELECT status, order_id FROM invoices WHERE payment_hash = $1',
        [invoice.payment_hash]
      );
      if (res.rows.length > 0) {
        const { status, order_id } = res.rows[0];
        if (status !== invoice.status) {
          await client.query(
            'UPDATE invoices SET status = $1 WHERE payment_hash = $2',
            [invoice.status, invoice.payment_hash]
          );
        }

        // Collect order ids with potentially completed payments
        if (!orderUpdates[order_id]) {
          orderUpdates[order_id] = [];
        }
        orderUpdates[order_id].push(invoice.status);
      }
    }

    // Check if all invoices under an order are marked as 'paid'
    for (const order_id in orderUpdates) {
      if (orderUpdates[order_id].every(status => status === 'paid')) {
        await client.query(
          'UPDATE orders SET status = $1 WHERE order_id = $2',
          ['bonds_locked', order_id]
        );
        console.log(`Order ${order_id} updated to bonds_locked`);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    console.error('Error while syncing invoices:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function syncPayoutsWithNode() {
  const agent = new https.Agent({
    rejectUnauthorized: false // DANGER: Only for development, remove in production!
  });

  const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Rune': MY_RUNE,
    },
    agent
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }

  const { invoices } = await response.json();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const invoice of invoices) {
      const ln_invoice = invoice.bolt11; // This assumes 'bolt11' is the field name for the invoice in the response
      const res = await client.query(
        'SELECT status FROM payouts WHERE ln_invoice = $1',
        [ln_invoice]
      );

      if (res.rows.length > 0 && res.rows[0].status !== invoice.status) {
        await client.query(
          'UPDATE payouts SET status = $1 WHERE ln_invoice = $2',
          [invoice.status, ln_invoice]
        );
        console.log(`Payout status updated for ln_invoice ${ln_invoice}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    console.error('Error updating payout statuses:', error);
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


async function generateBolt11Invoice(amount_msat, label, description, type, premium) {
  const data = {
    amount_msat: parseInt(amount_msat),
    label,
    description,
    cltv: 770,
    type,    // Assuming the API supports this directly or needs additional handling
    premium  // Same as above
  };
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const invoiceData = await response.json();
    if (!invoiceData.bolt11) {
      console.error('Response missing bolt11:', invoiceData);
      throw new Error('bolt11 is missing in the response');
    }
    return invoiceData;
  } catch (error) {
    console.error('Error in generating Bolt11 invoice:', error);
    throw error;
  }
}

async function settleHoldInvoice(payment_hash) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/settleinvoice`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    return await response.json();  // Expecting a confirmation response from the Lightning node
  } catch (error) {
    console.error('Failed to settle invoice:', error);
    throw error;
  }
}

async function postFullAmountInvoice(amount_msat, label, description, orderId, orderType) {
  if (orderType !== 1) {
      // If the order type is not 1, do not create a full amount invoice
      console.log(`Full amount invoice not required for order type ${orderType}.`);
      return null;
  }

  const data = {
      amount_msat,  // Use the full amount
      label,
      description,
      cltv: 770,
  };

  try {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
          method: 'POST',
          headers: {
              'Accept': 'application/json',
              'Rune': MY_RUNE,
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
          agent: new https.Agent({ rejectUnauthorized: false })
      });

      if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status} while posting full amount invoice`);
      }

      const invoiceData = await response.json();
      console.log(`Full amount invoice created for order ${orderId}`);
      return invoiceData;
  } catch (error) {
      console.error('Failed to post full amount invoice:', error);
      throw error;
  }
}

export {
  postHoldinvoice,
  holdInvoiceLookup,
  generateBolt11Invoice,
  syncInvoicesWithNode,
  syncPayoutsWithNode,
  settleHoldInvoice,
  postFullAmountInvoice
};
