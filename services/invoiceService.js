// Import statements for ES Modules
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import pkg from 'pg';  // Corrected import for CommonJS module
import { retrievePayoutInvoice } from './payoutService.js';
import { createPayout } from './payoutService.js';
//import { updatePayoutStatus } from './orderService.js';

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

async function handleFiatReceived(orderId) {
  const client = await pool.connect();
  try {
      await client.query('BEGIN'); // Start the transaction

      // Update payout status to 'fiat_received'
      const updateResult = await updatePayoutStatus(client, orderId, 'fiat_received');
      if (updateResult.rowCount === 0) {
          throw new Error('No corresponding payout found or update failed');
      }

      // Retrieve the payout invoice details (LN invoice being paid from)
      const payoutDetails = await client.query(
          `SELECT ln_invoice FROM payouts WHERE order_id = $1`,
          [orderId]
      );
      if (payoutDetails.rows.length === 0) {
          throw new Error('No payout details found for this order');
      }
      const payoutInvoice = payoutDetails.rows[0].ln_invoice;

      // Retrieve the originating FULL invoice details (LN invoice marked as FULL)
      const fullInvoiceDetails = await client.query(
          `SELECT bolt11 FROM invoices WHERE order_id = $1 AND invoice_type = 'full'`,
          [orderId]
      );
      if (fullInvoiceDetails.rows.length === 0) {
          throw new Error('No FULL invoice details found for this order');
      }
      const fullInvoice = fullInvoiceDetails.rows[0].bolt11;

      // Log the originating FULL invoice and the payout invoice details
      console.log("Originating FULL LN Invoice:", fullInvoice);
      console.log("Payout LN Invoice:", payoutInvoice);

      // Attempt to settle the hold invoice (using the payout invoice)
      const settlementResult = await settleHoldInvoice(payoutInvoice);
      if (!settlementResult || settlementResult.status !== 'succeeded') {
          throw new Error('Failed to settle hold invoice');
      }

      // Log the successful settlement
      console.log("Successfully settled invoice for LN Invoice:", payoutInvoice);

      await client.query('COMMIT'); // Commit the transaction if everything is successful
      console.log("Fiat received and invoice settled successfully.");
  } catch (error) {
      await client.query('ROLLBACK'); // Rollback the transaction on error
      console.error("Error processing fiat received:", error);
      throw error;
  } finally {
      client.release(); // Release the database connection
  }
}

async function updatePayoutStatus(client, orderId, status) {
    try {
        // Update the status of the payout in the payouts table
        const result = await client.query(
            'UPDATE payouts SET status = $1 WHERE order_id = $2 RETURNING *',
            [status, orderId]
        );

        // Check if the payout was updated successfully
        if (result.rows.length === 0) {
            throw new Error('Failed to update payout status');
        }

        return result;
    } catch (error) {
        throw error;
    }
}


async function settleHoldInvoice(lnInvoice) {
  try {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
          method: 'POST',
          headers: {
              'Accept': 'application/json',
              'Rune': MY_RUNE,
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ payment_hash: lnInvoice }),
          agent: new https.Agent({ rejectUnauthorized: false }) // Reminder to handle SSL in production
      });

      if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status}`);
      }

      return await response.json(); // Returns a confirmation of the invoice settlement
  } catch (error) {
      console.error('Failed to settle invoice:', error);
      throw error;
  }
}

async function generateAndSettleHoldInvoice(amount_msat, label, description, type, premium) {
  const data = {
    amount_msat: parseInt(amount_msat),
    label,
    description,
    cltv: 770,
    type,
    premium
  };

  try {
    // Generate the hold invoice
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

    // Extract payment_hash from the generated invoice
    const { payment_hash } = invoiceData;
    console.log('Generated hold invoice:', invoiceData);

    // Settle the hold invoice
    const settleResponse = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!settleResponse.ok) {
      throw new Error(`HTTP Error: ${settleResponse.status}`);
    }

    const settleData = await settleResponse.json();
    console.log('Settled hold invoice:', settleData);

    return { invoiceData, settleData };

  } catch (error) {
    console.error('Error in generating and settling hold invoice:', error);
    throw error;
  }
}



async function checkAndProcessPendingPayouts() {
  const client = await pool.connect();
  try {
      const result = await client.query(
          "SELECT order_id FROM payouts WHERE status = 'fiat_received'"
      );

      for (const row of result.rows) {
          await handleFiatReceived(row.order_id);
      }
  } catch (error) {
      console.error('Error processing pending payouts:', error);
  } finally {
      client.release();
  }
}

const settleHoldInvoiceByHash = async (payment_hash) => {
  try {
    console.log(`Settling hold invoice with payment_hash: ${payment_hash}`);

    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
      method: 'POST', // Ensure the method is POST as per documentation
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const settleData = await response.json();
    console.log('Settled hold invoice:', settleData);

    return settleData;
  } catch (error) {
    console.error('Error in settling hold invoice:', error);
    throw error;
  }
};


export {
  postHoldinvoice,
  holdInvoiceLookup,
  generateBolt11Invoice,
  syncInvoicesWithNode,
  syncPayoutsWithNode,
  postFullAmountInvoice,
  handleFiatReceived,
  settleHoldInvoice,
  checkAndProcessPendingPayouts,
  updatePayoutStatus,
  settleHoldInvoiceByHash
};
