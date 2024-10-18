import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import { retrievePayoutInvoice, createPayout } from './payoutService.js';
import axios from 'axios';

config();

const prisma = new PrismaClient();

const agent = new https.Agent({
  rejectUnauthorized: false
});

const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const RUNE = process.env.RUNE;

async function postHoldinvoice(amount_msat: number, description: string, orderId: number | string, userType: string) {
  const orderIdNumber = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
  
  if (isNaN(orderIdNumber)) {
    throw new Error('Invalid orderId provided');
  }

  const timestamp = Date.now();
  const label = `invoice_${orderIdNumber}_${timestamp}`;

  console.log('Posting hold invoice with:', { amount_msat, label, description, orderId: orderIdNumber, userType });
  console.log('Using RUNE:', RUNE);

  try {
    if (!LIGHTNING_NODE_API_URL || !RUNE) {
      throw new Error('LIGHTNING_NODE_API_URL or RUNE is not defined');
    }

    const holdAmount = Math.floor(amount_msat * 0.05);
    console.log(`Adjusted hold amount: ${holdAmount} msat (5% of ${amount_msat} msat)`);

    const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
      amount_msat: holdAmount,
      label,
      description,
      cltv: 144,
    }, {
      headers: { 
        'Content-Type': 'application/json',
        'Rune': RUNE
      },
      httpsAgent: agent
    });
    
    console.log('Hold invoice response:', response.data);
    
    if (!response.data || !response.data.bolt11 || !response.data.payment_hash) {
      throw new Error('Invalid response from Lightning Node API: ' + JSON.stringify(response.data));
    }
    
    const invoiceData = {
      bolt11: response.data.bolt11,
      payment_hash: response.data.payment_hash,
      status: 'unpaid',
      invoice_type: 'hold'
    };

    return invoiceData;
  } catch (error) {
    console.error('Error posting hold invoice:', error.response ? error.response.data : error.message);
    throw error;
  }
}


async function holdInvoiceLookup(payment_hash: string) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicelookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Rune': RUNE,
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Hold invoice lookup response:', data);

    if (data.state === 'ACCEPTED') {
      await updateInvoiceStatus(payment_hash, 'paid');
    }

    return {
      state: data.state,
      htlc_expiry: data.htlc_expiry,
      // Include other relevant data from the response
    };
  } catch (error) {
    console.error('Error in holdInvoiceLookup:', error);
    throw error;
  }
}

async function updateInvoiceStatus(payment_hash: string, status: string) {
  try {
    const updatedInvoice = await prisma.invoice.updateMany({
      where: { payment_hash: payment_hash },
      data: { status: status },
    });

    console.log(`Updated invoice status for payment_hash ${payment_hash} to ${status}`);
    return updatedInvoice;
  } catch (error) {
    console.error('Error updating invoice status:', error);
    throw error;
  }
}

async function syncInvoicesWithNode() {
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

    const orderUpdates: { [key: string]: string[] } = {};

    for (const invoice of invoices) {
      console.log(`Processing invoice with payment_hash: ${invoice.payment_hash}`);
      const dbInvoice = await prisma.invoice.findFirst({
        where: { payment_hash: invoice.payment_hash },
        select: { status: true, order_id: true, invoice_type: true, user_type: true }
      });

      if (dbInvoice) {
        const { status, order_id, invoice_type, user_type } = dbInvoice;
        let newStatus = invoice.status;

        console.log(`Invoice details: type=${invoice_type}, user_type=${user_type}, current status=${status}`);

        if (invoice_type === 'hold') {
          console.log(`Checking hold invoice with payment_hash: ${invoice.payment_hash}`);
          const holdState = await holdInvoiceLookup(invoice.payment_hash);
          console.log(`Hold state for invoice with payment_hash ${invoice.payment_hash}:`, holdState);

          if (holdState.state === 'ACCEPTED' || holdState.state === 'settled') {
            newStatus = 'ACCEPTED';
          } else if (holdState.state === 'canceled') {
            newStatus = 'canceled';
          } else {
            newStatus = holdState.state;
          }

          console.log(`New status for ${user_type} hold invoice: ${newStatus}`);
        }

        if (status !== newStatus) {
          console.log(`Updating invoice status for payment_hash ${invoice.payment_hash} from ${status} to ${newStatus}`);
          await prisma.invoice.update({
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

async function generateBolt11Invoice(amount_msat: number, label: string, description: string, type: string, premium: number) {
  const data = {
    amount_msat: parseInt(amount_msat.toString()),
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

async function postFullAmountInvoice(amount_msat: number, label: string, description: string, orderId: number, orderType: string) {
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

async function handleFiatReceived(orderId: number | string) {
  console.log(`Starting handleFiatReceived for order ID: ${orderId}`);
  try {
    await prisma.$transaction(async (prisma) => {
      // Find the pending payout
      const pendingPayout = await prisma.payout.findFirst({
        where: { 
          order_id: parseInt(orderId as string),
          status: 'pending'
        }
      });
      console.log(`Pending payout for order ID ${orderId}:`, pendingPayout);

      if (!pendingPayout) {
        throw new Error(`No pending payout found for order ID: ${orderId}`);
      }

      // Pay the invoice
      console.log(`Attempting to pay invoice for order ID: ${orderId}`);
      const paymentResult = await payInvoice(pendingPayout.ln_invoice);
      console.log(`Payment result for order ID ${orderId}:`, paymentResult);

      if (!paymentResult || paymentResult.status !== 'complete') {
        throw new Error('Failed to pay payout invoice');
      }

      // Update payout status to 'fiat_received'
      console.log(`Updating payout status to 'fiat_received' for order ID: ${orderId}`);
      const updateResult = await prisma.payout.update({
        where: { payout_id: pendingPayout.payout_id },
        data: { status: 'fiat_received' }
      });
      console.log(`Updated payout:`, updateResult);
    });

    console.log(`Fiat received and payout processed successfully for order ID: ${orderId}`);
  } catch (error) {
    console.error(`Error processing fiat received for order ID ${orderId}:`, error);
    throw error;
  }
}

async function payInvoice(lnInvoice: string) {
  console.log(`Attempting to pay invoice: ${lnInvoice}`);
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

    console.log(`Response status: ${response.status}`);
    const responseBody = await response.text();
    console.log(`Response body: ${responseBody}`);

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}. Body: ${responseBody}`);
    }

    const result = JSON.parse(responseBody);
    console.log(`Payment result:`, result);
    return result;
  } catch (error) {
    console.error('Failed to pay invoice:', error);
    throw error;
  }
}
async function updatePayoutStatus(orderId: number, status: string) {
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

async function settleHoldInvoice(paymentHash: string) {
  try {
    console.log(`Attempting to settle hold invoice with payment hash: ${paymentHash}`);
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/settleholdinvoice`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash: paymentHash }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });
  
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
  
    const result = await response.json();
    console.log(`Hold invoice settled successfully:`, result);
    return result;
  } catch (error) {
    console.error('Failed to settle hold invoice:', error);
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

const settleHoldInvoiceByHash = async (payment_hash: string) => {
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

const settleHoldInvoicesByOrderIdService = async (orderId: number) => {
  try {
    await prisma.$transaction(async (prisma) => {
      const invoices = await prisma.invoice.findMany({
        where: { order_id: orderId, invoice_type: 'hold', status: 'ACCEPTED' },
        select: { payment_hash }
      });
  
      const settlePromises = invoices.map(async (invoice) => {
        const settleData = await settleHoldInvoiceByHash(invoice.payment_hash);
  
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

async function notifyUsers(orderId: number) {
  console.log(`Chatroom is available for Order ID: ${orderId} for both y and Taker`);
}

async function handleChatroomTrigger(orderId: number) {
  // @ts-expect-error TS(2304): Cannot find name 'generateChatId'.
  const chatId = generateChatId(orderId); // Replace with your chatroom logic
  //console.log(`Chatroom ID ${chatId} is created for Order ID: ${orderId}`);
    
  await notifyUsers(orderId);
    
  return chatId;
}

const CHAT_APP_URL = process.env.CHAT_APP_URL || 'http://localhost:3456';
async function checkInvoicesAndCreateChatroom(orderId: number, userId: number) {
  // console.log(`[checkInvoicesAndCreateChatroom] Starting process for Order ID: ${orderId}`);
  try {
    const allInvoices = await prisma.invoice.findMany({
      where: { order_id: orderId }
    });
    // console.log(`[checkInvoicesAndCreateChatroom] Found ${allInvoices.length} invoices for Order ID: ${orderId}`);

    // allInvoices.forEach((invoice, index) => {
    //   console.log(`[checkInvoicesAndCreateChatroom] Invoice ${index + 1} details:`, {
    //     invoice_id: invoice.invoice_id,
    //     status: invoice.status,
    //     invoice_type: invoice.invoice_type,
    //     user_type: invoice.user_type,
    //     amount_msat: invoice.amount_msat.toString()
    //   });
    // });

    const allInvoicesPaid = allInvoices.length === 3 && 
                            allInvoices.every(invoice => invoice.status === 'paid');

    //console.log(`[checkInvoicesAndCreateChatroom] All invoices paid for Order ID ${orderId}: ${allInvoicesPaid}`);

    if (allInvoicesPaid) {
       //console.log(`[checkInvoicesAndCreateChatroom] Updating order ${orderId} status to chat_open`);
      const updatedOrder = await prisma.order.update({
        where: { order_id: orderId },
        data: { status: 'chat_open' }
      });
      // console.log(`[checkInvoicesAndCreateChatroom] Order ${orderId} update result:`, updatedOrder);

      const order = await prisma.order.findUnique({
        where: { order_id: orderId },
      });

      let userRole = 'unknown';
      if (order.customer_id === userId) {
        userRole = 'maker';
      } else if (order.taker_customer_id === userId) {
        userRole = 'taker';
      }

      const makeOfferUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
      const acceptOfferUrl = `${CHAT_APP_URL}/ui/chat/accept-offer?orderId=${orderId}`;
      // console.log(`[checkInvoicesAndCreateChatroom] Chatroom URLs created for Order ID: ${orderId}`);

      return { makeOfferUrl, acceptOfferUrl, userRole };
    } else {
      // console.log(`[checkInvoicesAndCreateChatroom] Not all invoices are paid for Order ID: ${orderId}. No chatroom created.`);
      return { makeOfferUrl: null, acceptOfferUrl: null, userRole: null };
    }
  } catch (error) {
    // console.error(`[checkInvoicesAndCreateChatroom] Error processing Order ID ${orderId}:`, error);
    throw error;
  }
}
async function createChatroom(orderId: number) {
  return `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
}

async function updateOrderStatus(orderId: number, status: string) {
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

async function getHoldInvoicesByOrderId(orderId: number) {
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

async function settleHoldInvoices(orderId: number) {
  try {
    await prisma.$transaction(async (prisma) => {
      await prisma.order.update({
        where: { order_id: orderId },
        data: { status: 'trade_complete' }
      });
  
      const holdInvoices = await getHoldInvoicesByOrderId(orderId);
      const settlePromises = holdInvoices.map(paymentHash => settleHoldInvoice(paymentHash));
  
      const settledInvoices = await Promise.all(settlePromises);
      return settledInvoices;
    });
  } catch (error) {
    throw error;
  }
}

async function generateInvoice(amount_msat: number, description: string, label: string) {
  const data = {
      amount_msat,
      label,
      description,
      cltv: 770
  };
  
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
  
      const responseBody = await response.text();
      console.log('Received response body:', responseBody);
  
      if (!response.ok) {
          console.error(`HTTP Error: ${response.status} with body: ${responseBody}`);
          throw new Error(`HTTP Error: ${response.status}`);
      }
  
      const invoiceData = JSON.parse(responseBody);
      if (!invoiceData.bolt11) {
          console.error('Response missing bolt11:', invoiceData);
          throw new Error('Bolt11 is missing in the response');
      }
  
      console.log('Received invoice data:', invoiceData);
  
      return invoiceData;
  } catch (error) {
      console.error('Error in generating Bolt11 invoice:', error);
      throw error;
  }
}

async function fullInvoiceLookup(paymentHash: string) {
  try {
    console.log(`Performing full invoice lookup for payment_hash: ${paymentHash}`);
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
    console.log('Lightning node response:', invoices);
    
    const invoice = invoices.find(inv => inv.payment_hash === paymentHash);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    // Update the database if the invoice is paid
    if (invoice.status === 'paid') {
      await prisma.invoice.update({
        where: { payment_hash: paymentHash },
        data: { status: 'paid', paid_at: new Date() },
      });
      console.log(`Updated invoice ${paymentHash} to paid status in database`);
    }
    
    return invoice;
  } catch (error) {
    console.error('Error looking up and updating full invoice:', error);
    throw error;
  }
}

export const checkInvoicePayment = async (paymentHash) => {
  try {
    console.log(`Checking payment status for hash: ${paymentHash}`);
    const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, 
      { payment_hash: paymentHash },
      {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Rune': RUNE
        },
        httpsAgent: agent
      }
    );

    console.log('Lightning node response:', response.data);

    if (response.data.invoices && response.data.invoices.length > 0) {
      const invoice = response.data.invoices[0];
      const isPaid = invoice.status === 'paid' || invoice.paid === true;
      console.log(`Invoice ${paymentHash} paid status: ${isPaid}`);
      return isPaid;
    } else {
      console.log(`Invoice with payment hash ${paymentHash} not found on Lightning node`);
      return false;
    }
  } catch (error) {
    console.error(`Error checking invoice payment for ${paymentHash}:`, error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    return false;
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
  checkInvoicePayment,
  fullInvoiceLookup,
};