// Import statements for ES Modules
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import pkg from 'pg';
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

// creates the hold invoice and 
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


async function holdInvoiceLookup(payment_hash) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicelookup`, {
      method: 'POST',
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
    const invoiceData = await response.json();
    console.log('Invoice Data:', invoiceData);
    return invoiceData;
  } catch (error) {
    console.error('Failed to lookup hold invoice:', error);
    throw error;
  }
}

// // Test the function
// const paymentHash = 'c1ef4a63cdc00081afef0e50cfa1a1874bbf3312e36831eb2db2c7cc0f9d2c31';

// holdInvoiceLookup(paymentHash)
//   .then(data => console.log('Hold Invoice Lookup Data:', data))
//   .catch(error => console.error('Error:', error));


async function syncInvoicesWithNode() {
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
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
    console.log('Fetched invoices from node:', invoices);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderUpdates = {};

      for (const invoice of invoices) {
        console.log(`Processing invoice with payment_hash: ${invoice.payment_hash}`);
        const res = await client.query(
          'SELECT status, order_id, invoice_type FROM invoices WHERE payment_hash = $1',
          [invoice.payment_hash]
        );
        if (res.rows.length > 0) {
          const { status, order_id, invoice_type } = res.rows[0];
          let newStatus = invoice.status;

          // Additional check for hold invoices
          if (invoice_type === 'hold') {
            console.log(`Checking hold invoice with payment_hash: ${invoice.payment_hash}`);
            const holdState = await holdInvoiceLookup(invoice.payment_hash);
            console.log(`Hold state for invoice with payment_hash ${invoice.payment_hash}:`, holdState);

            if (holdState.state === 'accepted' || holdState.state === 'settled') {
              newStatus = 'accepted';
            } else if (holdState.state === 'canceled') {
              newStatus = 'canceled';
            }
          }

          if (status !== newStatus) {
            console.log(`Updating invoice status for payment_hash ${invoice.payment_hash} from ${status} to ${newStatus}`);
            await client.query(
              'UPDATE invoices SET status = $1 WHERE payment_hash = $2',
              [newStatus, invoice.payment_hash]
            );
            console.log(`Invoice with payment_hash ${invoice.payment_hash} updated to status: ${newStatus}`);
          } else {
            console.log(`Invoice with payment_hash ${invoice.payment_hash} already has status: ${newStatus}`);
          }

          if (!orderUpdates[order_id]) {
            orderUpdates[order_id] = [];
          }
          orderUpdates[order_id].push(newStatus);
        } else {
          console.log(`No matching record found in the database for invoice with payment_hash ${invoice.payment_hash}`);
        }
      }

      for (const order_id in orderUpdates) {
        const statuses = orderUpdates[order_id];
        const allHoldInvoices = statuses.filter(status => status === 'accepted').length === 2;
        const fullInvoicePaid = statuses.includes('paid');

        if (allHoldInvoices && fullInvoicePaid) {
          await client.query(
            'UPDATE orders SET status = $1 WHERE order_id = $2',
            ['chat_open', order_id]
          );
          console.log(`Order ${order_id} updated to chat_open`);
        } else {
          console.log(`Order ${order_id} does not meet the criteria for chat_open`);
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
  } catch (error) {
    console.error('Error fetching invoices from node:', error);
    throw error;
  }
}


async function syncPayoutsWithNode() {
  const agent = new https.Agent({
    rejectUnauthorized: false
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
      const ln_invoice = invoice.bolt11;
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
    type,
    premium
  };
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, { // Changed to regular invoice endpoint
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
  const data = {
      amount_msat,
      label,
      description,
      cltv: 770,
  };

  try {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
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
          throw new Error(`HTTP Error: ${response.status}`);
      }

      const invoiceData = await response.json();
      if (!invoiceData.bolt11) {
          console.error('Response missing bolt11:', invoiceData);
          throw new Error('bolt11 is missing in the response');
      }

      console.log(`Full amount invoice created for order ${orderId}:`, invoiceData);
      return invoiceData;
  } catch (error) {
      console.error('Failed to post full amount invoice:', error);
      throw error;
  }
}

async function handleFiatReceived(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await updatePayoutStatus(client, orderId, 'fiat_received');
    if (updateResult.rowCount === 0) {
      throw new Error('No corresponding payout found or update failed');
    }

    const payoutDetails = await client.query(
      `SELECT ln_invoice FROM payouts WHERE order_id = $1`,
      [orderId]
    );
    if (payoutDetails.rows.length === 0) {
      throw new Error('No payout details found for this order');
    }
    const payoutInvoice = payoutDetails.rows[0].ln_invoice;

    console.log("Payout LN Invoice:", payoutInvoice);

    const paymentResult = await payInvoice(payoutInvoice);
    if (!paymentResult || paymentResult.status !== 'complete') {
      throw new Error('Failed to pay payout invoice');
    }

    console.log("Successfully paid payout invoice:", payoutInvoice);

    await client.query('COMMIT');
    console.log("Fiat received and payout processed successfully.");
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error processing fiat received:", error);
    throw error;
  } finally {
    client.release();
  }
}

async function payInvoice(lnInvoice) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/pay`, { // Changed to pay endpoint
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bolt11: lnInvoice }),
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to pay invoice:', error);
    throw error;
  }
}

async function updatePayoutStatus(client, orderId, status) {
  try {
    const result = await client.query(
      'UPDATE payouts SET status = $1 WHERE order_id = $2 RETURNING *',
      [status, orderId]
    );

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
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    return await response.json();
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

    const { payment_hash } = invoiceData;
    console.log('Generated hold invoice:', invoiceData);

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
      method: 'POST',
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

const settleHoldInvoicesByOrderIdService = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch all hold invoices for the order
    const invoicesResult = await client.query(
      'SELECT payment_hash FROM invoices WHERE order_id = $1 AND invoice_type = $2 AND status = $3',
      [orderId, 'hold', 'unpaid']
    );

    const settlePromises = invoicesResult.rows.map(async (invoice) => {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Rune': MY_RUNE,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payment_hash: invoice.payment_hash }),
        agent: new https.Agent({ rejectUnauthorized: false })
      });

      if (!response.ok) {
        throw new Error(`Failed to settle invoice with payment_hash: ${invoice.payment_hash}`);
      }

      const settleData = await response.json();
      return settleData;
    });

    const settledInvoices = await Promise.all(settlePromises);
    await client.query('COMMIT');
    return settledInvoices;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Add these new functions at the appropriate place in your existing invoiceService.js

async function notifyUsers(orderId) {
  console.log(`Chatroom is available for Order ID: ${orderId} for both Maker and Taker`);
}

async function handleChatroomTrigger(orderId) {
  const chatId = generateChatId(orderId); // Replace with your chatroom logic
  console.log(`Chatroom ID ${chatId} is created for Order ID: ${orderId}`);
  
  // Notify both users that the chatroom is available
  await notifyUsers(orderId);
  
  return chatId;
}

async function createChatroom(orderId) {
  const chatroomUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
  return chatroomUrl;
}

const CHAT_APP_URL = 'http://localhost:3456';

async function checkInvoicesAndCreateChatroom(orderId) {
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
      },
      agent
    });

    if (!response.ok) {
      console.error(`HTTP Error: ${response.status} while fetching invoices`);
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const { invoices } = await response.json();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invoiceStatuses = await client.query(
        'SELECT payment_hash, status, invoice_type FROM invoices WHERE order_id = $1',
        [orderId]
      );

      const invoiceMap = new Map(invoiceStatuses.rows.map(row => [row.payment_hash, row]));

      let allHoldInvoices = true;
      let fullInvoicePaid = false;
      let holdCount = 0;

      for (const dbInvoice of invoiceMap.values()) {
        const invoice = invoices.find(inv => inv.payment_hash === dbInvoice.payment_hash);

        if (!invoice) {
          console.log(`Invoice with payment_hash ${dbInvoice.payment_hash} not found in Lightning node response`);
          allHoldInvoices = false;
          break;
        }

        console.log(`Checking invoice ${invoice.payment_hash} - dbStatus: ${dbInvoice.status}, apiStatus: ${invoice.status}, invoice_type: ${dbInvoice.invoice_type}`);

        if (dbInvoice.invoice_type === 'full') {
          if (invoice.status !== 'paid') {
            console.log(`Full invoice with payment_hash ${dbInvoice.payment_hash} is not in paid status (apiStatus: ${invoice.status})`);
            fullInvoicePaid = false;
            allHoldInvoices = false;
            break;
          } else {
            fullInvoicePaid = true;
          }
        } else if (dbInvoice.invoice_type === 'hold') {
          if (invoice.status === 'hold') {
            holdCount += 1;
          } else {
            allHoldInvoices = false;
          }
        }

        if (dbInvoice.status !== invoice.status) {
          await client.query(
            'UPDATE invoices SET status = $1 WHERE payment_hash = $2 AND order_id = $3',
            [invoice.status, invoice.payment_hash, orderId]
          );
          console.log(`Invoice with payment_hash ${invoice.payment_hash} updated to '${invoice.status}'`);
        }
      }

      await client.query('COMMIT');

      if (holdCount >= 2 && fullInvoicePaid) {
        await client.query(
          'UPDATE orders SET status = $1 WHERE order_id = $2',
          ['chat_open', orderId]
        );
        const chatroomUrl = await createChatroom(orderId);
        console.log(`Chatroom can be created for Order ID: ${orderId}. Redirect to: ${chatroomUrl}`);
        return chatroomUrl;
      } else {
        console.log(`allHoldInvoices: ${allHoldInvoices}, fullInvoicePaid: ${fullInvoicePaid}`);
        console.log(`Not all invoices are in the required state for Order ID: ${orderId}`);
        return null;
      }

    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('Database transaction error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error checking and updating invoices:', error);
    throw error;
  }
}


// Function to create a chatroom


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
  settleHoldInvoiceByHash,
  payInvoice, // Export payInvoice
  settleHoldInvoicesByOrderIdService,
  checkInvoicesAndCreateChatroom,
  createChatroom
};
