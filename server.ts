import express from 'express';
import cors from 'cors';
import { authenticateJWT } from './middleware/authMiddleware.js';
import { generateToken } from './utils/auth.js';
import {
  postHoldinvoice,
  holdInvoiceLookup,
  syncInvoicesWithNode,
  syncPayoutsWithNode,
  handleFiatReceived,
  settleHoldInvoicesByOrderIdService,
} from './services/invoiceService.js';
import { registerUser, authenticateUser, pollAndCompleteRegistration } from './services/userService.js';
import orderRoutes from './routes/orderRoutes.js';
import payoutsRoutes from './routes/payoutRoutes.js';
import settleRoutes from './routes/settleRoutes.js';
import { initializeNDK } from './config/ndkSetup.js';
import { checkAndCreateChatroom, updateAcceptOfferUrl } from './services/chatService.js';
import dotenv from 'dotenv';
import submitToMainstayRoutes from './routes/submitToMainstay.js';
import { PrismaClient } from '@prisma/client';
import { createOrder } from './controllers/orderController';
import { createOrder } from './controllers/orderController.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const prisma = new PrismaClient();

app.use(express.json());

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = ['http://localhost:3001', 'http://localhost:3000', 'http://localhost:5173'];
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Custom-Header'],
    credentials: true,
  })
);

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await registerUser(username, password);
    res.status(201).json({
      message: 'Registration initiated, please pay the invoice to complete registration.',
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        invoice: user.invoice,
      },
      invoice: user.invoice,
    });
  } catch (error) {
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
  const { username, password } = req.body;

  try {
    console.log(`Login attempt for user: ${username}`);
    const user = await authenticateUser(username, password);
    console.log(`User authenticated: ${user.username}`);
    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    console.error(`Login failed for user: ${username ? username : 'unknown user'} - Error: ${error.message}`);
    res.status(401).json({ message: 'Login failed', error: error.message });
  }
});



app.post('/api/holdinvoice', authenticateJWT, async (req, res) => {
  try {
    const { amount_msat, label, description } = req.body;
    const result = await postHoldinvoice(amount_msat, label, description);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/holdinvoicelookup', authenticateJWT, async (req, res) => {
  try {
    const result = await holdInvoiceLookup(req.body.payment_hash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use('/api/orders', authenticateJWT, orderRoutes);
app.use('/api/payouts', authenticateJWT, payoutsRoutes);

app.post('/api/order',)

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
    res.status(500).json({ message: 'Failed to synchronize payouts', error: error.message });
  }
});

app.post('/api/fiat-received', authenticateJWT, async (req, res) => {
  try {
    const { order_id } = req.body;
    await handleFiatReceived(order_id);
    res.status(200).json({ message: 'Fiat received processed successfully' });
  } catch (error) {
    console.error('Error processing fiat received:', error);
    res.status(500).json({ message: 'Error processing fiat received', error: error.message });
  }
});

app.post('/api/settle-holdinvoices-by-order', authenticateJWT, async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await settleHoldInvoicesByOrderIdService(orderId);
    res.status(200).json({ message: 'Hold invoices settled successfully', result });
  } catch (error) {
    res.status(500).json({ message: 'Error settling hold invoices', error: error.message });
  }
});


app.post('/api/check-accepted-invoices', authenticateJWT, async (req, res) => {
  try {
    await checkAndUpdateAcceptedInvoices();
    res.status(200).send({ message: 'Invoices checked and updated successfully.' });
  } catch (error) {
    res.status(500).send({ error: 'Failed to check and update invoices' });
  }
});

app.post('/api/check-and-create-chatroom', authenticateJWT, async (req, res) => {
  const { orderId } = req.body;
  const userId = req.user.id; // Assuming `req.user` contains the authenticated user's details

  try {
    // Fetch the order details
    const order = await prisma.orders.findUnique({
      where: { order_id: parseInt(orderId) },
    });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    console.log('Order details:', order);
    console.log('User ID:', userId);

    // Check if the user is the maker or taker of the order
    if (order.customer_id !== userId && order.taker_customer_id !== userId) {
      return res.status(403).json({ message: 'You are not authorized to access this chatroom' });
    }

    // Proceed to create or check chatroom
    const { makeOfferUrl, acceptOfferUrl } = await checkAndCreateChatroom(orderId);
    res.status(200).json({ makeChatUrl: makeOfferUrl, acceptChatUrl: acceptOfferUrl });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create chatroom', error: error.message });
  }
});

// Endpoint to update accept-offer URL
app.post('/api/update-accept-offer-url', authenticateJWT, async (req, res) => {
  try {
    const { chat_id, accept_offer_url } = req.body;
    await updateAcceptOfferUrl(chat_id, accept_offer_url);
    res.status(200).json({ message: 'Accept-offer URL updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update accept-offer URL', error: error.message });
  }
});

app.use('/api/settle', settleRoutes);

// Get all orders
app.get('/api/orders', authenticateJWT, async (req, res) => {
  try {
    const result = await prisma.orders.findMany();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get order by ID
app.get('/api/orders/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await prisma.orders.findUnique({
      where: { order_id: parseInt(orderId) },
    });
    if (!result) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get invoice by order ID
app.get('/api/invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  console.log(`Fetching invoices for order ID: ${orderId}`);

  try {
    const result = await prisma.invoices.findMany({
      where: { order_id: parseInt(orderId) },
    });

    console.log('Invoices Response:', result);

    if (result.length === 0) {
      console.log('No invoices found for the given order ID.');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Serialize the BigInt value
    const invoice = {
      ...result[0],
      amount_msat: result[0].amount_msat.toString(),
    };

    console.log('Returning the first invoice in the result set.');
    res.status(200).json(invoice);
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/taker-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await prisma.invoices.findMany({
      where: {
        order_id: parseInt(orderId),
        user_type: 'taker'
      },
    });
    if (result.length === 0) {
      return res.status(404).json({ error: 'Taker invoice not found' });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/full-invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await prisma.invoices.findFirst({
      where: {
        order_id: parseInt(orderId),
        invoice_type: 'full',
      },
    });
    if (!result) {
      return res.status(404).json({ error: 'Full invoice not found' });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to lookup full invoice by payment hash
app.post('/api/fullinvoicelookup', authenticateJWT, async (req, res) => {
  const { payment_hash } = req.body;
  try {
    const result = await prisma.invoices.findFirst({
      where: {
        payment_hash: payment_hash,
        invoice_type: 'full',
      },
    });
    if (!result) {
      return res.status(404).json({ error: 'Full invoice not found' });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      where: { username: username },
      select: { invoice: true, payment_hash: true, status: true },
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

let server;

initializeNDK().then(() => {
  if (!server) {
    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Try a different port.`);
      } else {
        console.error('An error occurred while starting the server:', error);
      }
    });
  } else {
    console.log('Server is already running.');
  }
});