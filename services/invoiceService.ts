import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import { retrievePayoutInvoice } from './payoutService.js';
import { createPayout } from './payoutService.js';
import axios from 'axios';

config(); // This line configures dotenv to load the environment variables

const prisma = new PrismaClient();

const agent = new https.Agent({
  rejectUnauthorized: false
});

const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const RUNE = process.env.RUNE;

async function postHoldinvoice(amount_msat, description) {
  const timestamp = Date.now(); // Generate a unique timestamp
  const label = `invoice_${timestamp}`; // Create a unique label using the timestamp

  console.log('Posting hold invoice with:', { amount_msat, label, description });
  console.log('Using RUNE:', RUNE); // Log the rune to ensure it is correctly set

  try {
      if (!LIGHTNING_NODE_API_URL || !RUNE) {
          throw new Error('LIGHTNING_NODE_API_URL or RUNE is not defined');
      }

      const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
        amount_msat,
        label,
        description
      }, {
        headers: { 
          'Content-Type': 'application/json',
          'Rune': RUNE
        },
        httpsAgent: agent  // Ensure the agent is included here
      });
      
      console.log('Hold invoice response:', response.data);
      
      if (!response.data || !response.data.bolt11 || !response.data.payment_hash) {
          throw new Error('Invalid response from Lightning Node API: ' + JSON.stringify(response.data));
      }
      
      // Return the invoice data with invoice_type set to 'makerHold'
      return {
          bolt11: response.data.bolt11,
          payment_hash: response.data.payment_hash,
          status: 'unpaid',
          invoice_type: 'makerHold'  // Ensure this field is included
      };
  } catch (error) {
      console.error('Error posting hold invoice:', error.response ? error.response.data : error.message);
      throw error;
  }
}
// Remaining functions remain unchanged

async function holdInvoiceLookup(payment_hash) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.invoices && data.invoices.length > 0) {
      const invoice = data.invoices[0];
      
      // Check if the invoice status is 'paid' and update the database
      if (invoice.status === 'paid') {
        await updateInvoiceStatus(payment_hash, 'paid');
      }
      
      return invoice;
    } else {
      throw new Error('Invoice not found');
    }
  } catch (error) {
    console.error('Error fetching invoice:', error);
    throw error;
  }
}
async function updateInvoiceStatus(payment_hash, status) {
  try {
    const updatedInvoice = await prisma.invoice.updateMany({
      where: { payment_hash },
      data: { status },
    });

    console.log(`Updated invoice status for payment_hash ${payment_hash}: ${status}`);
    return updatedInvoice;
  } catch (error) {
    console.error('Failed to update invoice status:', error);
    throw error;
  }
}
// Syncs the invoice status from lightning with the database
async function syncInvoicesWithNode() {
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
      },
      agent
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    const { invoices } = await response.json();
    console.log('Fetched invoices from node:', invoices);

    const orderUpdates = {};

    for (const invoice of invoices) {
      console.log(`Processing invoice with payment_hash: ${invoice.payment_hash}`);
      const res = await prisma.invoice.findMany({
        where: { payment_hash: invoice.payment_hash },
        select: { status, order_id, invoice_type }
      });

      if (res.length > 0) {
        const { status, order_id, invoice_type } = res[0];
        let newStatus = invoice.status;

        // Additional check for hold invoices
        if (invoice_type === 'hold') {
          console.log(`Checking hold invoice with payment_hash: ${invoice.payment_hash}`);
          const holdState = await holdInvoiceLookup(invoice.payment_hash);
          console.log(`Hold state for invoice with payment_hash ${invoice.payment_hash}:`, holdState);

          if (holdState.state === 'ACCEPTED' || holdState.state === 'settled') {
            newStatus = 'ACCEPTED';
          } else if (holdState.state === 'canceled') {
            newStatus = 'canceled';
          }
        }

        if (status !== newStatus) {
          console.log(`Updating invoice status for payment_hash ${invoice.payment_hash} from ${status} to ${newStatus}`);
          await prisma.invoice.updateMany({
            where: { payment_hash: invoice.payment_hash },
            data: { status: newStatus }
          });
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
      const allHoldInvoices = statuses.filter((status) => status === 'ACCEPTED').length === 2;
      const fullInvoicePaid = statuses.includes('ACCEPTED');

      if (allHoldInvoices && fullInvoicePaid) {
        await prisma.order.update({
          where: { order_id: parseInt(order_id) },
          data: { status: 'chat_open' }
        });
        console.log(`Order ${order_id} updated to chat_open`);
      } else {
        console.log(`Order ${order_id} does not meet the criteria for chat_open`);
      }
    }

  } catch (error) {
    console.error('Error fetching invoices from node:', error);
    throw error;
  }
}

// Syncs payouts with node. 
async function syncPayoutsWithNode() {
  const agent = new https.Agent({
    rejectUnauthorized: false
  });

  const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Rune': RUNE,
    },
    agent
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }

  const { invoices } = await response.json();

  try {
    for (const invoice of invoices) {
      const ln_invoice = invoice.bolt11;
      const res = await prisma.payout.findMany({
        where: { ln_invoice },
        select: { status }
      });

      if (res.length > 0 && res[0].status !== invoice.status) {
        await prisma.payout.updateMany({
          where: { ln_invoice },
          data: { status: invoice.status }
        });
        console.log(`Payout status updated for ln_invoice ${ln_invoice}`);
      }
    }
  } catch (error) {
    console.error('Error updating payout statuses:', error);
    throw error;
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
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, { 
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
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
      console.log(`Attempting to create full invoice for order ${orderId}:`, data);
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
          method: 'POST',
          headers: {
              'Accept': 'application/json',
              'Rune': RUNE,
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
          agent: new https.Agent({ rejectUnauthorized: false })
      });

      if (!response.ok) {
          const errorBody = await response.text();
          console.error(`Error response from Lightning node: ${response.status} ${response.statusText}`, errorBody);
          throw new Error(`HTTP Error: ${response.status} - ${errorBody}`);
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
  try {
    await prisma.$transaction(async (prisma) => {
      const updateResult = await prisma.payout.updateMany({
        where: { order_id: orderId, status: 'fiat_received' },
        data: { status: 'fiat_received' }
      });

      if (updateResult.count === 0) {
        throw new Error('No corresponding payout found or update failed');
      }

      const payoutDetails = await prisma.payout.findMany({
        where: { order_id: orderId },
        select: { ln_invoice }
      });

      if (payoutDetails.length === 0) {
        throw new Error('No payout details found for this order');
      }

      const payoutInvoice = payoutDetails[0].ln_invoice;

      console.log("Payout LN Invoice:", payoutInvoice);

      const paymentResult = await payInvoice(payoutInvoice);
      if (!paymentResult || paymentResult.status !== 'complete') {
        throw new Error('Failed to pay payout invoice');
      }

      console.log("Successfully paid payout invoice:", payoutInvoice);
    });

    console.log("Fiat received and payout processed successfully.");
  } catch (error) {
    console.error("Error processing fiat received:", error);
    throw error;
  }
}

async function payInvoice(lnInvoice) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/pay`, { 
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
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

async function updatePayoutStatus(orderId, status) {
  try {
    const result = await prisma.payout.updateMany({
      where: { order_id: orderId },
      data: { status }
    });

    if (result.count === 0) {
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
        'Rune': RUNE,
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

async function checkAndProcessPendingPayouts() {
  try {
    const result = await prisma.payout.findMany({
      where: { status: 'fiat_received' },
      select: { order_id }
    });

    for (const row of result) {
      await handleFiatReceived(row.order_id);
    }
  } catch (error) {
    console.error('Error processing pending payouts:', error);
  }
}

const settleHoldInvoiceByHash = async (payment_hash) => {
  try {
    console.log(`Settling hold invoice with payment_hash: ${payment_hash}`);

    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
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
  try {
    await prisma.$transaction(async (prisma) => {
      // Fetch all hold invoices for the order
      const invoices = await prisma.invoice.findMany({
        where: { order_id: orderId, invoice_type: 'hold', status: 'ACCEPTED' },
        select: { payment_hash }
      });

      const settlePromises = invoices.map(async (invoice) => {
        const settleData = await settleHoldInvoiceByHash(invoice.payment_hash);

        // Update the invoice status to 'settled' in the database
        await prisma.invoice.updateMany({
          where: { payment_hash: invoice.payment_hash },
          data: { status: 'settled' }
        });

        return settleData;
      });

      const settledInvoices = await Promise.all(settlePromises);
      return settledInvoices;
    });
  } catch (error) {
    throw error;
  }
};

// Generic chat functions that are not currently being used.
// placeholders for alerting users when their chatroom is open
async function notifyUsers(orderId) {
  console.log(`Chatroom is available for Order ID: ${orderId} for both y and Taker`);
}

async function handleChatroomTrigger(orderId) {
  // @ts-expect-error TS(2304): Cannot find name 'generateChatId'.
  const chatId = generateChatId(orderId); // Replace with your chatroom logic
  //console.log(`Chatroom ID ${chatId} is created for Order ID: ${orderId}`);
  
  // Notify both users that the chatroom is available
  await notifyUsers(orderId);
  
  return chatId;
}

// Chatroom code that hooks into the chat app and returns the chatroom when invoices are marked as paid for the orderId

const CHAT_APP_URL = 'http://localhost:3456';
async function checkInvoicesAndCreateChatroom(orderId) {
  const agent = new https.Agent({ rejectUnauthorized: false });

  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
      },
      agent
    });

    if (!response.ok) {
      console.error(`HTTP Error: ${response.status} while fetching invoices`);
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const { invoices } = await response.json();

    try {
      const invoiceStatuses = await prisma.invoice.findMany({
        where: { order_id: orderId },
        select: { payment_hash, status, invoice_type }
      });

      const invoiceMap = new Map(invoiceStatuses.map(row => [row.payment_hash, row]));

      let allHoldInvoices = true;
      let fullInvoicePaid = false;
      let holdCount = 0;

      for (const dbInvoice of invoiceMap.values()) {
        const invoice = invoices.find((inv) => inv.payment_hash === dbInvoice.payment_hash);

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
          await prisma.invoice.updateMany({
            where: { payment_hash: invoice.payment_hash, order_id: orderId },
            data: { status: invoice.status }
          });
          console.log(`Invoice with payment_hash ${invoice.payment_hash} updated to '${invoice.status}'`);
        }
      }

      if (holdCount >= 2 && fullInvoicePaid) {
        await prisma.order.update({
          where: { order_id: orderId },
          data: { status: 'chat_open' }
        });
        const chatroomUrl = await createChatroom(orderId);
        console.log(`Chatroom can be created for Order ID: ${orderId}. Redirect to: ${chatroomUrl}`);
        return chatroomUrl;
      } else {
        console.log(`allHoldInvoices: ${allHoldInvoices}, fullInvoicePaid: ${fullInvoicePaid}`);
        console.log(`Not all invoices are in the required state for Order ID: ${orderId}`);
        return null;
      }

    } catch (dbError) {
      console.error('Database transaction error:', dbError);
      throw dbError;
    }
  } catch (error) {
    console.error('Error checking and updating invoices:', error);
    throw error;
  }
}

async function createChatroom(orderId) {
  return `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
}

async function updateOrderStatus(orderId, status) {
  try {
    const result = await prisma.order.update({
      where: { order_id: orderId },
      data: { status }
    });

    return result;
  } catch (error) {
    throw error;
  }
}

async function getHoldInvoicesByOrderId(orderId) {
  try {
    const result = await prisma.invoice.findMany({
      where: { order_id: orderId, invoice_type: 'hold', status: 'ACCEPTED' },
      select: { payment_hash }
    });

    return result.map(row => row.payment_hash);
  } catch (error) {
    throw error;
  }
}

async function settleHoldInvoices(orderId) {
  try {
    await prisma.$transaction(async (prisma) => {
      // Update order status to 'trade_complete'
      await prisma.order.update({
        where: { order_id: orderId },
        data: { status: 'trade_complete' }
      });

      // Get all hold invoices for the order
      const holdInvoices = await getHoldInvoicesByOrderId(orderId);
      const settlePromises = holdInvoices.map(paymentHash => settleHoldInvoice(paymentHash));

      // Settle all hold invoices
      const settledInvoices = await Promise.all(settlePromises);
      return settledInvoices;
    });
  } catch (error) {
    throw error;
  }
}

async function generateInvoice(amount_msat, description, label) {
  const data = {
      amount_msat,  // Make sure this is in millisatoshis and the value is correct
      label,        // Unique identifier for the invoice
      description,  // Description for the invoice
      cltv: 770     // Ensure this CLTV value is ACCEPTED by your Lightning service
  };

  // Log the request data for debugging purposes
  console.log('Sending data to generate invoice:', data);

  try {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
          method: 'POST',
          headers: {
              'Accept': 'application/json',
              'Rune': RUNE,
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
          agent: new https.Agent({ rejectUnauthorized: false }),
      });

      // Read and log the full response body for debugging
      const responseBody = await response.text();
      console.log('Received response body:', responseBody);

      if (!response.ok) {
          // Log detailed error message before throwing
          console.error(`HTTP Error: ${response.status} with body: ${responseBody}`);
          throw new Error(`HTTP Error: ${response.status}`);
      }

      const invoiceData = JSON.parse(responseBody);
      if (!invoiceData.bolt11) {
          console.error('Response missing bolt11:', invoiceData);
          throw new Error('Bolt11 is missing in the response');
      }

      // Log the successful invoice data retrieval
      console.log('Received invoice data:', invoiceData);

      return invoiceData;
  } catch (error) {
      // Log and rethrow the error to be handled or logged further up the call stack
      console.error('Error in generating Bolt11 invoice:', error);
      throw error;
  }
}

export const checkInvoiceStatus = async (payment_hash) => {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.error(`HTTP Error: ${response.status} with body: ${responseBody}`);
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    if (data.invoices && data.invoices.length > 0) {
      return data.invoices[0];
    } else {
      throw new Error('Invoice not found');
    }
  } catch (error) {
    console.error('Error checking invoice status:', error);
    throw error;
  }
};

const checkInvoicePayment = async (payment_hash) => {
  try {
    const invoice = await checkInvoiceStatus(payment_hash);
    return invoice.status === 'paid';
  } catch (error) {
    console.error('Error checking invoice payment:', error);
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
  settleHoldInvoiceByHash,
  payInvoice, 
  settleHoldInvoicesByOrderIdService,
  checkInvoicesAndCreateChatroom,
  createChatroom,
  settleHoldInvoices, 
  updateOrderStatus,  
  getHoldInvoicesByOrderId,
  generateInvoice,
  checkInvoicePayment  
};
