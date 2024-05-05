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

async function postHoldinvoice(amount_msat, label, description) {
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
    rejectUnauthorized: false  // DANGER: This disables SSL/TLS certificate verification.
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
      const res = await client.query(
        'SELECT status FROM invoices WHERE payment_hash = $1',
        [invoice.payment_hash]
      );
      if (res.rows.length > 0 && res.rows[0].status !== invoice.status) {
        await client.query(
          'UPDATE invoices SET status = $1 WHERE payment_hash = $2',
          [invoice.status, invoice.payment_hash]
        );
      }
    }
    await client.query('COMMIT');
    console.log('Invoices updated successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function generateBolt11Invoice(amount_msat, label, description) {
  const data = {
      amount_msat: parseInt(amount_msat),
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

export {
  postHoldinvoice,
  holdInvoiceLookup,
  generateBolt11Invoice,
  syncInvoicesWithNode
};
