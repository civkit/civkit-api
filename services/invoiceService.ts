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

    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        order_id: orderIdNumber,
        invoice_type: 'hold',
        user_type: userType,
        status: { in: ['pending', 'unpaid'] }
      }
    });

    if (existingInvoice) {
      console.log(`Existing hold invoice found for order ${orderIdNumber} and user type ${userType}`);
      return {
        bolt11: existingInvoice.bolt11,
        payment_hash: existingInvoice.payment_hash,
        status: existingInvoice.status,
        invoice_type: 'hold'
      };
    }

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

    const savedInvoice = await prisma.invoice.create({
      data: {
        order_id: orderIdNumber,
        bolt11: invoiceData.bolt11,
        amount_msat: BigInt(holdAmount),
        description: description,
        status: invoiceData.status,
        created_at: new Date(),
        expires_at: new Date(response.data.expires_at * 1000),
        payment_hash: invoiceData.payment_hash,
        invoice_type: 'hold',
        user_type: userType,
      },
    });

    console.log('Hold invoice saved to database:', savedInvoice);

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

async function handleFiatReceived(orderId: number) {
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

      const holdInvoice = await prisma.invoice.findFirst({
        where: { order_id: orderId, invoice_type: 'hold' },
        select: { payment_hash: true }
      });

      if (holdInvoice) {
        await settleHoldInvoice(holdInvoice.payment_hash);
      }

      console.log("Successfully paid payout invoice and settled hold invoice");
    });

    console.log("Fiat received and payout processed successfully.");
  } catch (error) {
    console.error("Error processing fiat received:", error);
    throw error;
  }
}

async function payInvoice(lnInvoice: string) {
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

const CHAT_APP_URL = 'http://localhost:3456';
async function checkInvoicesAndCreateChatroom(orderId: number) {
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
        const invoice = invoices.find((inv: any) => inv.payment_hash === dbInvoice.payment_hash);
  
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

async function fullInvoiceLookup(paymentHash) {
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
    
    // Find the specific invoice we're looking for
    const invoice = invoices.find(inv => inv.payment_hash === paymentHash);
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    return invoice;
  } catch (error) {
    console.error('Error looking up full invoice:', error);
    throw error;
  }
}

async function checkInvoicePayment(payment_hash: string) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Rune': RUNE,
      },
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!response.ok) {
      // Only log critical errors
      if (response.status !== 404) {
        console.error(`Critical error checking invoice payment: HTTP ${response.status}`);
      }
      return false; // Assume unpaid for any error
    }

    const invoiceData = await response.json();
    if (invoiceData.status === 'paid') {
      console.log(`Invoice ${payment_hash} is paid.`);
    }
    return invoiceData.status === 'paid';
  } catch (error) {
    // Only log unexpected errors
    console.error('Unexpected error in checkInvoicePayment:', error.message);
    return false; // Assume unpaid for any error
  }
}




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
  fullInvoiceLookup
};