import express from 'express';
import cors from 'cors';
import { authenticateJWT, identifyUserRoleInOrder } from './middleware/authMiddleware.js';
import { generateToken } from './utils/auth.js';
import {
  postHoldinvoice,
  holdInvoiceLookup,
  syncInvoicesWithNode,
  syncPayoutsWithNode,
  handleFiatReceived,
  settleHoldInvoicesByOrderIdService,
  fullInvoiceLookup,
  checkInvoicesAndCreateChatroom,
  postFullAmountInvoice
} from './services/invoiceService.js';
import { registerUser, authenticateUser,   pollAndCompleteRegistration } from './services/userService.js';
import orderRoutes from './routes/orderRoutes.js';
import payoutsRoutes from './routes/payoutRoutes.js';
import settleRoutes from './routes/settleRoutes.js';
import { initializeNDK } from './config/ndkSetup.js';
import { checkAndCreateChatroom, updateAcceptOfferUrl } from './services/chatService.js';
import { query, pool } from './config/db.js';
import dotenv from 'dotenv'
import submitToMainstayRoutes from './routes/submitToMainstay.js';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';
import axios from 'axios';
import https from 'node:https';
import { announceCivKitNode } from './utils/nostrAnnouncements.js';
import { createPayout } from './services/payoutService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const prisma = new PrismaClient();
const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const RUNE = process.env.RUNE;

console.log('LIGHTNING_NODE_API_URL:', LIGHTNING_NODE_API_URL);
console.log('RUNE:', RUNE);

if (!LIGHTNING_NODE_API_URL || !RUNE) {
  console.error('Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

const agent = new https.Agent({
  rejectUnauthorized: false
});

app.use(express.json());

const allowedOrigins = ['*'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes('*')) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await registerUser(username, password);
    res.status(201).json({
      message: 'Registration initiated, please pay the invoice to complete registration.',
      user: {
        id: user.id,
        username: user.username,
        password: user.password,
        created_at: user.created_at,
        invoice: user.invoice,
      },
      invoice: user.invoice  // Display the invoice to register
    });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

// polls invoices to see if registration is complete
setInterval(async () => {
  try {
    await pollAndCompleteRegistration();
  } catch (error) {
    console.error('Error during registration polling:', error);
  }
}, 20000); // 20 seconds


// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await authenticateUser(username, password);

    // Check if the user's registration status is complete
    if (user.status !== 'complete') {
      return res.status(403).json({ message: 'Registration not complete. Please complete the registration process.' });
    }

    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(401).json({ message: 'Login failed', error: error.message });
  }
});

app.post('/api/holdinvoice', authenticateJWT, async (req, res) => {
  console.log('Received request at /api/holdinvoice');
  console.log('Request body:', req.body);
  try {
    const { amount_msat, label, description } = req.body;
    console.log('Extracted values:', { amount_msat, label, description });
    const result = await postHoldinvoice(amount_msat, label, description);
    console.log('postHoldinvoice result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/holdinvoice:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/holdinvoicelookup', authenticateJWT, async (req, res) => {
  console.log('[/api/holdinvoicelookup] Received request');
  const { payment_hash } = req.body;
  console.log('[/api/holdinvoicelookup] Payment hash:', payment_hash);
  try {
    const result = await holdInvoiceLookup(payment_hash);
    console.log('[/api/holdinvoicelookup] Lookup result:', result);
    res.json(result);
  } catch (error) {
    console.error('[/api/holdinvoicelookup] Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.use('/api/orders', authenticateJWT, orderRoutes);
app.use('/api/payouts', authenticateJWT, payoutsRoutes);

app.post('/api/sync-invoices', authenticateJWT, async (req, res) => {
  try {
    await syncInvoicesWithNode();
    res.status(200).json({ message: 'Invoices synchronized successfully' });
  } catch (error) {
    console.error('Failed to sync invoices:', error);
    res.status(500).json({ message: 'Failed to synchronize invoices', error: error.message });
  }
});

app.get('/api/sync-payouts', authenticateJWT, async (req, res) => {
  try {
    await syncPayoutsWithNode();
    res.status(200).json({ message: 'Payouts synchronized successfully' });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ message: 'Failed to synchronize payouts', error: error.message });
  }
});

// Add this function to your authMiddleware.ts or create a new middleware file
export const authorizeForFiatReceived = async (req, res, next) => {
  const orderId = parseInt(req.body.order_id);
  const userId = req.user.id;

  try {
    const order = await prisma.order.findUnique({
      where: { order_id: orderId },
      select: { type: true, customer_id: true, taker_customer_id: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const isAuthorized = (order.type === 0 && order.taker_customer_id === userId) || 
                         (order.type === 1 && order.customer_id === userId);

    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    next();
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// In your server.ts, modify the fiat-received route
app.post('/api/fiat-received', authenticateJWT, authorizeForFiatReceived, async (req, res) => {
  try {
    const { order_id } = req.body;
    const result = await handleFiatReceived(parseInt(order_id));
    
    // If there's a payment error from the lightning node
    if (result?.error) {
      return res.status(400).json({
        error: 'Payment Failed',
        details: result.error,
        code: result.code || 'PAYMENT_ERROR'
      });
    }
    
    res.status(200).json({ message: 'Fiat received processed successfully' });
  } catch (error) {
    console.error('Error processing fiat received:', error);
    // Send structured error response
    res.status(500).json({
      error: 'Payment Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      code: error.code || 'INTERNAL_ERROR'
    });
  }
});

app.post('/api/settle-holdinvoices-by-order', authenticateJWT, async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await settleHoldInvoicesByOrderIdService(orderId);
    res.status(200).json({ message: 'Hold invoices settled successfully', result });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ message: 'Error settling hold invoices', error: error.message });
  }
});

// Initialize NDK and create identity
async function startServer() {
  try {
    app.listen(PORT,  () => {
      console.log(`Server running on port ${PORT}`);
      announceCivKitNode()
        .then(() => console.log('CivKit node announced successfully'))
        .catch(error => console.error('Failed to announce CivKit node:', error));
    });

    // Announce every 24 hours
    setInterval(() => {
      announceCivKitNode()
        .then(() => console.log('CivKit node announced successfully'))
        .catch(error => console.error('Failed to announce CivKit node:', error));
    }, 24 * 60 * 60 * 1000);

  } catch (error) {
    console.error('Failed to start server:', error);
  }
}

startServer();

app.post('/api/check-accepted-invoices', authenticateJWT, async (req, res) => {
  try {
    // @ts-expect-error TS(2304): Cannot find name 'checkAndUpdateAcceptedInvoices'.
    await checkAndUpdateAcceptedInvoices();
    res.status(200).send({ message: 'Invoices checked and updated successfully.' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to check and update invoices' });
  }
});

app.post('/api/check-and-create-chatroom', authenticateJWT, async (req, res) => {
  const { orderId } = req.body;
  const userId = req.user.id;
  try {
    const order = await prisma.order.findUnique({
      where: { order_id: orderId },
      include: { chats: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const isMaker = order.customer_id === userId;
    const isTaker = order.taker_customer_id === userId;

    if (!isMaker && !isTaker) {
      return res.status(403).json({ error: 'Unauthorized access to this order' });
    }

    let chat = order.chats[0];

    if (!chat) {
      // Create a new chat if one doesn't exist
      const makeOfferUrl = `http://localhost:3456/ui/chat/make-offer?orderId=${orderId}`;
      
      // Make a request to the chat app to create the make offer URL
      const chatAppResponse = await axios.post(
        `${process.env.CHAT_APP_URL}/api/chat/make-offer`,
        { orderId },
        {
          headers: {
            'Content-Type': 'application/json',
            // Add any necessary authentication headers for the chat app
          }
        }
      );

      if (!chatAppResponse.data || !chatAppResponse.data.token) {
        throw new Error('Failed to create make offer URL in chat app');
      }

      const chatToken = chatAppResponse.data.token;
      const chatRoomUrl = `https://chat.civkit.africa/ui/chat/room/${chatToken}`;

      chat = await prisma.chat.create({
        data: {
          order_id: orderId,
          chatroom_url: chatRoomUrl,
          make_offer_url: makeOfferUrl,
          chat_token: chatToken,
          // We'll set accept_offer_url later when the maker hits the make-offer endpoint
          accept_offer_url: null
        }
      });
    }

    const responseData = {
      makeOfferUrl: chat.make_offer_url,
      acceptOfferUrl: isTaker ? chat.accept_offer_url : null,
      userRole: isMaker ? 'maker' : 'taker'
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error('[/api/check-and-create-chatroom] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Endpoint to update accept-offer URL
app.post('/api/update-accept-offer-url', authenticateJWT, async (req, res) => {
  try {
    const { chat_id, accept_offer_url } = req.body;
    // Ensure accept_offer_url is a complete URL
    if (!accept_offer_url.startsWith('http://') && !accept_offer_url.startsWith('https://')) {
      throw new Error('Invalid accept_offer_url format');
    }
    await updateAcceptOfferUrl(chat_id, accept_offer_url);
    res.status(200).json({ message: 'Accept-offer URL updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update accept-offer URL', error: error.message });
  }
});

app.use('/api/settle', settleRoutes);

// Modify the existing route to use identifyUserRoleInOrder middleware
app.get('/api/orders/:orderId', authenticateJWT, identifyUserRoleInOrder, async (req, res) => {
  const order = req.order;
  const userRole = req.userRole;
  const acceptOfferUrl = req.acceptOfferUrl;

  res.json({
    order,
    userRole,
    acceptOfferUrl: userRole === 'taker' ? acceptOfferUrl : null
  });
});

// Add a new route to fetch all orders with user roles
app.get('/api/all-orders', authenticateJWT, async (req, res) => {
  try {
    const orders = await prisma.order.findMany();
    const ordersWithRoles = await Promise.all(orders.map(async (order) => {
      const orderWithRole = { ...order };
      await identifyUserRoleInOrder({ user: req.user, params: { orderId: order.order_id } }, res, () => {});
      orderWithRole.userRole = res.locals.userRole;
      orderWithRole.acceptOfferUrl = res.locals.acceptOfferUrl;
      return orderWithRole;
    }));
    res.status(200).json(ordersWithRoles);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get invoice by order ID
app.get('/api/invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        order_id: parseInt(orderId)
      }
    });

    if (!invoices || invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Convert BigInt fields to strings
    const serializedInvoices = invoices.map(invoice => ({
      ...invoice,
      amount_msat: invoice.amount_msat.toString(),
      amount_received_msat: invoice.amount_received_msat ? invoice.amount_received_msat.toString() : null,
      created_at: invoice.created_at.toISOString(),
      expires_at: invoice.expires_at.toISOString(),
      paid_at: invoice.paid_at ? invoice.paid_at.toISOString() : null
    }));

    res.status(200).json(serializedInvoices);
  } catch (err) {
    console.error('Error fetching invoice:', err);
    res.status(500).json({ error: 'An error occurred while fetching the invoice' });
  }
});

app.get('/api/taker-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        order_id: parseInt(orderId),
        user_type: 'taker'
      }
    });

    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Taker invoice not found' });
    }

    // Convert BigInt fields to strings for JSON serialization
    const serializedInvoices = invoices.map(invoice => ({
      ...invoice,
      amount_msat: invoice.amount_msat.toString(),
      amount_received_msat: invoice.amount_received_msat ? invoice.amount_received_msat.toString() : null,
      created_at: invoice.created_at.toISOString(),
      expires_at: invoice.expires_at.toISOString(),
      paid_at: invoice.paid_at ? invoice.paid_at.toISOString() : null
    }));

    res.status(200).json(serializedInvoices);
  } catch (err) {
    console.error('Error fetching taker invoice:', err);
    res.status(500).json({ error: 'An error occurred while fetching the taker invoice' });
  }
});

app.get('/api/full-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    let invoice = await prisma.invoice.findFirst({
      where: { order_id: parseInt(orderId), invoice_type: 'full' }
    });

    if (!invoice) {
      const order = await prisma.order.findUnique({ where: { order_id: parseInt(orderId) } });
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const label = `full_invoice_${orderId}_${Date.now()}`;
      const description = `Full invoice for order ${orderId}`;
      const invoiceData = await postFullAmountInvoice(order.amount_msat, label, description, order.order_id, order.type.toString());

      invoice = await prisma.invoice.create({
        data: {
          order_id: parseInt(orderId),
          bolt11: invoiceData.bolt11,
          amount_msat: BigInt(order.amount_msat),
          description,
          status: 'unpaid',
          created_at: new Date(),
          expires_at: new Date(invoiceData.expires_at * 1000),
          payment_hash: invoiceData.payment_hash,
          invoice_type: 'full',
          user_type: 'taker'
        }
      });
    }

    res.json({ invoice: { ...invoice, amount_msat: invoice.amount_msat.toString() } });
  } catch (error) {
    console.error('Error fetching or creating full invoice:', error);
    res.status(500).json({ error: 'Failed to fetch or create full invoice' });
  }
});

// Call this function periodically
setInterval(async () => {
  try {
    await pollAndCompleteRegistration();
  } catch (error) {
    console.error('Error during registration polling:', error);
  }
}, 20000); // 20 seconds interval

app.post('/api/get-invoice', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        invoice: true,
        payment_hash: true,
        status: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { invoice, payment_hash, status } = user;
    res.status(200).json({ invoice, payment_hash, status });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use('/api', submitToMainstayRoutes);

console.log('Registering /api/taker-invoice/:orderId route');

app.post('/api/taker-invoice/:orderId', authenticateJWT, async (req, res) => {
  console.log('Received request for taker invoice:', req.params.orderId);
  const orderId = parseInt(req.params.orderId);
  const takerId = req.user.id;

  try {
    const order = await prisma.order.findUnique({
      where: { order_id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const holdInvoice = await createTakerHoldInvoice(orderId, order.amount_msat, `Taker hold invoice for Order ${orderId}`);

    const updatedOrder = await prisma.order.update({
      where: { order_id: orderId },
      data: { 
        taker_customer_id: takerId,
        status: 'taker_found'
      },
    });

    res.status(200).json(serializeBigInt({
      message: 'Taker hold invoice created successfully',
      order: updatedOrder,
      holdInvoice,
    }));
  } catch (error) {
    console.error('[API] Error creating taker hold invoice:', error);
    res.status(500).json({ error: 'Failed to create taker hold invoice', details: error.message });
  }
});

export async function createTakerHoldInvoice(orderId: number, amount_msat: number, description: string) {
  console.log(` [createTakerHoldInvoice] Starting for orderId: ${orderId}`);

  // Add this line to calculate 5%
  const holdAmount = Math.floor(amount_msat * 0.05);

  return await prisma.$transaction(async (prisma) => {
    // Check for existing invoice within the transaction
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        order_id: orderId,
        user_type: 'taker',
        invoice_type: 'hold',
      }
    });

    if (existingInvoice) {
      console.log(`[createTakerHoldInvoice] Existing hold invoice found for order ${orderId}`);
      return existingInvoice;
    }

    console.log(`[createTakerHoldInvoice] No existing invoice found. Creating new invoice for order ${orderId}`);

    const timestamp = Date.now();
    const label = `taker_hold_${orderId}_${timestamp}`;

    // Now create the hold invoice on the Lightning node
    try {
      const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
        amount_msat: holdAmount, // Use holdAmount instead of amount_msat
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

      console.log(`[createTakerHoldInvoice] Lightning node response:`, response.data);

      if (!response.data || !response.data.bolt11 || !response.data.payment_hash) {
        throw new Error('Invalid response from Lightning Node API: ' + JSON.stringify(response.data));
      }

      // Create the invoice in the database with the real data
      const newInvoice = await prisma.invoice.create({
        data: {
          order_id: orderId,
          bolt11: response.data.bolt11,
          amount_msat: BigInt(amount_msat),
          description: description,
          status: 'unpaid',
          created_at: new Date(),
          expires_at: new Date(response.data.expires_at * 1000),
          payment_hash: response.data.payment_hash,
          invoice_type: 'hold',
          user_type: 'taker',
        },
      });

      console.log(`[createTakerHoldInvoice] Invoice created in database:`, {
        invoice_id: newInvoice.invoice_id,
        payment_hash: newInvoice.payment_hash,
      });

      return newInvoice;
    } catch (error) {
      console.error(`[createTakerHoldInvoice] Error creating taker hold invoice:`, error);
      throw error;
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}

function serializeBigInt(data: any): any {
  if (typeof data === 'bigint') {
    return data.toString();
  } else if (Array.isArray(data)) {
    return data.map(serializeBigInt);
  } else if (typeof data === 'object' && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return data;
}

app.post('/api/check-full-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const dbInvoice = await prisma.invoice.findFirst({
      where: { 
        order_id: parseInt(orderId), 
        invoice_type: 'full' 
      }
    });

    if (!dbInvoice) {
      return res.status(404).json({ error: 'Full invoice not found' });
    }

    const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {}, {
      headers: { 
        'Accept': 'application/json', 
        'Rune': RUNE
      },
      httpsAgent: agent
    });

    const { invoices } = response.data;

    const nodeInvoice = invoices.find(inv => inv.payment_hash === dbInvoice.payment_hash);

    if (!nodeInvoice) {
      return res.status(404).json({ error: 'Invoice not found on Lightning node' });
    }

    console.log(`Full invoice status for order ${orderId}: ${nodeInvoice.status}`);

    if (nodeInvoice.status === 'paid' && dbInvoice.status !== 'paid') {
      await prisma.invoice.updateMany({
        where: { 
          order_id: parseInt(orderId),
          invoice_type: 'full'
        },
        data: { status: 'paid' }
      });
      console.log(`Updated database status to paid for order ${orderId}`);
    }

    res.json({ status: nodeInvoice.status });
  } catch (error) {
    console.error('Error checking full invoice:', error);
    res.status(500).json({ error: 'Failed to check full invoice' });
  }
});

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working' });
});

app.get('/api/order/:orderId/latest-chat-details', authenticateJWT, async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const userId = req.user.id;

    // Check if the user is authorized to access this order
    const order = await prisma.order.findUnique({
      where: { order_id: orderId },
      select: { customer_id: true, taker_customer_id: true }
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const isMaker = order.customer_id === userId;
    const isTaker = order.taker_customer_id === userId;

    if (!isMaker && !isTaker) {
      return res.status(403).json({ message: 'Unauthorized access to this order' });
    }

    // Fetch the latest chat for this order
    const latestChat = await prisma.chat.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
      select: { chatroom_url: true, accept_offer_url: true }
    });

    if (!latestChat) {
      return res.status(404).json({ message: 'No chat found for this order' });
    }

    const chatUrl = isMaker ? latestChat.chatroom_url : latestChat.accept_offer_url;
    const userRole = isMaker ? 'maker' : 'taker';

    res.json({ chatUrl, userRole });
  } catch (error) {
    console.error('Error fetching latest chat details:', error);
    res.status(500).json({ message: 'Error fetching latest chat details' });
  }
});

app.get('/api/accept-offer-url/:orderId', authenticateJWT, identifyUserRoleInOrder, async (req, res) => {
  try {
    const userRole = req.userRole;
    const acceptOfferUrl = req.acceptOfferUrl;

    if (userRole !== 'taker') {
      return res.status(403).json({ message: 'Unauthorized access to this URL' });
    }

    if (acceptOfferUrl) {
      res.json({ url: acceptOfferUrl });
    } else {
      res.status(404).json({ message: 'URL not found' });
    }
  } catch (error) {
    console.error('Error fetching accept offer URL:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/payouts/submit', authenticateJWT, async (req, res) => {
  const { order_id, ln_invoice } = req.body;
  
  if (!order_id || !ln_invoice) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Fetch the order to ensure it exists and to get the amount
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(order_id) },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Create the payout record
    const payout = await prisma.payout.create({
      data: {
        order_id: parseInt(order_id),
        ln_invoice,
        amount_msat: order.amount_msat,
        status: 'pending',
      },
    });

    res.json({ message: 'Payout submitted successfully', payout });
  } catch (error) {
    console.error('Error submitting payout:', error);
    res.status(500).json({ error: 'Failed to submit payout' });
  }
});

app.post('/api/taker-full-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await prisma.order.findUnique({ where: { order_id: parseInt(orderId) } });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const existingInvoice = await prisma.invoice.findFirst({
      where: { order_id: parseInt(orderId), invoice_type: 'full', user_type: 'taker' }
    });

    if (existingInvoice) {
      return res.json({ invoice: serializeBigInt(existingInvoice) });
    }

    const label = `taker_full_invoice_${orderId}_${Date.now()}`;
    const description = `Taker full invoice for order ${orderId}`;
    const invoiceData = await postFullAmountInvoice(order.amount_msat, label, description, order.order_id, order.type.toString());

    const newInvoice = await prisma.invoice.create({
      data: {
        order_id: parseInt(orderId),
        bolt11: invoiceData.bolt11,
        amount_msat: BigInt(order.amount_msat),
        description,
        status: 'unpaid',
        created_at: new Date(),
        expires_at: new Date(invoiceData.expires_at * 1000),
        payment_hash: invoiceData.payment_hash,
        invoice_type: 'full',
        user_type: 'taker'
      }
    });

    res.json({ invoice: serializeBigInt(newInvoice) });
  } catch (error) {
    console.error('Error creating taker full invoice:', error);
    res.status(500).json({ error: 'Failed to create taker full invoice' });
  }
});

// Remove the authenticateJWT middleware
app.post('/api/create-make-offer', async (req, res) => {
  const { orderId } = req.body;
  
  console.log('Received request to create make-offer for orderId:', orderId);

  if (!orderId) {
    console.error('Order ID is missing in the request');
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) },
      include: { chats: true }
    });

    console.log('Found order:', order);

    if (!order) {
      console.error(`Order not found for ID: ${orderId}`);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Construct the make-offer URL
    const makeOfferUrl = `http://localhost:3456/ui/chat/make-offer?orderId=${order.order_id}`;

    // Return the complete URL
    res.json({ makeOfferUrl });

  } catch (error) {
    console.error('Error processing make-offer request:', error);
    res.status(500).json({ error: 'Failed to process make-offer request' });
  }
});

// Show all pending orders (no auth required)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { status: 'pending' },
          { status: 'Pending' }
        ]
      }
    });
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Show user's orders (requires auth)
app.get('/api/my-orders', authenticateJWT, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { customer_id: req.user.id },
          { taker_customer_id: req.user.id }
        ]
      }
    });
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/ratings/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  const { rating, remarks } = req.body;
  const userId = req.user.id;

  try {
    // First verify that the user is part of this order
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify user is either the maker or taker of the order
    if (order.customer_id !== userId && order.taker_customer_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to rate this order' });
    }

    // Determine if the rater is the maker or taker
    const isMaker = order.customer_id === userId;
    const rated_user_id = isMaker ? order.taker_customer_id : order.customer_id;

    // Check if this user has already rated for this order
    const existingRating = await prisma.rating.findFirst({
      where: {
        order_id: parseInt(orderId),
        rated_by_user_id: userId,
      }
    });

    if (existingRating) {
      return res.status(400).json({ error: 'You have already submitted a rating for this order' });
    }

    // Create the rating with the rated user information
    const newRating = await prisma.rating.create({
      data: {
        order_id: parseInt(orderId),
        rating: rating,
        remarks: remarks,
        rated_user_id: rated_user_id, // Add the ID of the user being rated
        rated_by_user_id: userId,     // Add the ID of the user giving the rating
      },
    });

    res.status(201).json({
      message: 'Rating submitted successfully',
      rating: newRating
    });

  } catch (error) {
    console.error('Error creating rating:', error);
    res.status(500).json({ error: 'Failed to create rating' });
  }
});

// Keep the GET endpoint for fetching ratings
app.get('/api/ratings/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    // Fetch orders where the user is either the customer or the taker
    const trades = await prisma.order.findMany({
      where: {
        OR: [
          { customer_id: parseInt(userId) },
          { taker_customer_id: parseInt(userId) }
        ]
      },
      include: {
        ratings: true
      }
    });

    // Format and return the response
    const response = trades.map(trade => ({
      order_id: trade.order_id,
      order_details: trade.order_details,
      amount_msat: trade.amount_msat,
      currency: trade.currency,
      status: trade.status,
      created_at: trade.created_at,
      ratings: trade.ratings.map(rating => ({
        rating_id: rating.rating_id,
        rating: rating.rating,
        remarks: rating.remarks,
        created_at: rating.created_at
      }))
    }));
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching user trades:', error);
    res.status(500).json({ error: 'Failed to fetch user trades' });
  }
});

// Add this endpoint with authentication
app.get('/api/users/ratings', authenticateJWT, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        created_at: true
      }
    });

    // Get all ratings directly (instead of going through orders)
    const ratings = await prisma.rating.findMany({
      include: {
        order: true
      }
    });

    // Transform the data to calculate ratings per user
    const userRatings = users.map(user => {
      // Get only ratings where this user was rated (rated_user_id)
      const userRatings = ratings.filter(rating => 
        rating.rated_user_id === user.id  // This is the key change
      );

      // Calculate average rating
      const averageRating = userRatings.length > 0
        ? userRatings.reduce((sum, rating) => sum + rating.rating, 0) / userRatings.length
        : null;

      return {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        total_ratings: userRatings.length,
        average_rating: averageRating ? Number(averageRating.toFixed(2)) : null,
        ratings: userRatings.map(rating => ({
          rating: rating.rating,
          remarks: rating.remarks,
          created_at: rating.created_at
        }))
      };
    });

    // Filter out users with no ratings
    const usersWithRatings = userRatings.filter(user => user.total_ratings > 0);

    res.status(200).json(usersWithRatings);
  } catch (error) {
    console.error('Error fetching user ratings:', error);
    res.status(500).json({ error: 'Failed to fetch user ratings' });
  }
});


app.post('/api/complete-trade/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user.id;

  try {
    // First verify user has access to this order
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify user is part of this trade
    if (order.customer_id !== userId && order.taker_customer_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { order_id: parseInt(orderId) },
      data: { 
        status: 'completed',
        escrow_status: 'released'
      }
    });

    res.status(200).json({
      message: 'Trade completed successfully',
      order: updatedOrder
    });

  } catch (error) {
    console.error('Error completing trade:', error);
    res.status(500).json({ error: 'Failed to complete trade' });
  }
});