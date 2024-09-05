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
  fullInvoiceLookup,
  settleHoldInvoicesByOrderIdService,
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
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { generateInvoiceLabel } from './utils/invoiceUtils.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const prisma = new PrismaClient();


app.use(express.json());

app.use(cors({
  origin: 'http://localhost:3001',
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
  credentials: true,
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
  try {
    const result = await holdInvoiceLookup(req.body.payment_hash);
    res.json(result);
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ error: error.message });
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
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
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

app.post('/api/fiat-received', authenticateJWT, async (req, res) => {
  try {
    const { order_id } = req.body;
    await handleFiatReceived(order_id);
    res.status(200).json({ message: 'Fiat received processed successfully' });
  } catch (error) {
    console.error('Error processing fiat received:', error);
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ message: 'Error processing fiat received', error: error.message });
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
initializeNDK().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

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
    // Fetch the order details
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

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
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ message: 'Failed to update accept-offer URL', error: error.message });
  }
});

app.use('/api/settle', settleRoutes);

// Get all orders
app.get('/api/orders', authenticateJWT, async (req, res) => {
  try {
    const orders = await prisma.order.findMany();
    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

//Get order by ID


app.get('/api/orders/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const order = await prisma.order.findUnique({
      where: {
        order_id: parseInt(orderId)
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ error: 'An error occurred while fetching the order' });
  }
});

// Get invoice by order ID
app.get('/api/invoice/:orderId', authenticateJWT, async (req, res) => {
  const { orderId } = req.params;
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        order_id: parseInt(orderId)
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Convert BigInt fields to strings
    const serializedInvoice = JSON.parse(
      JSON.stringify(invoice, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    res.status(200).json(serializedInvoice);
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
    const invoice = await prisma.invoice.findFirst({
      where: {
        order_id: parseInt(orderId),
        invoice_type: 'full'
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Full invoice not found for this order' });
    }

    // Check the invoice status and update if paid
    const invoiceStatus = await fullInvoiceLookup(invoice.payment_hash);

    // Refresh the invoice data in case it was updated
    const updatedInvoice = await prisma.invoice.findUnique({
      where: { invoice_id: invoice.invoice_id }
    });

    // Convert BigInt to String for JSON serialization
    const serializedInvoice = {
      ...updatedInvoice,
      amount_msat: updatedInvoice.amount_msat.toString(),
      amount_received_msat: updatedInvoice.amount_received_msat ? updatedInvoice.amount_received_msat.toString() : null,
      created_at: updatedInvoice.created_at.toISOString(),
      expires_at: updatedInvoice.expires_at.toISOString(),
      paid_at: updatedInvoice.paid_at ? updatedInvoice.paid_at.toISOString() : null
    };

    res.status(200).json({ invoice: serializedInvoice, lightningStatus: invoiceStatus });
  } catch (err) {
    console.error('Error fetching full invoice:', err);
    res.status(500).json({ error: 'An error occurred while fetching the full invoice' });
  }
});

// // endpoint to lookup full invoice by payment hash
// app.post('/api/fullinvoicelookup', authenticateJWT, async (req, res) => {
//   const { payment_hash } = req.body;
//   try {
//     const result = await query('SELECT * FROM invoices WHERE payment_hash = $1 AND invoice_type = $2', [payment_hash, 'full']);
//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: 'Full invoice not found' });
//     }
//     res.status(200).json(result.rows[0]);
//   } catch (err) {
//     // @ts-expect-error TS(2571): Object is of type 'unknown'.
//     res.status(500).json({ error: err.message });
//   }
// });



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

    const holdInvoice = await createTakerHoldInvoice(orderId, order.amount_msat, `Order ${orderId} for Taker`);

    const updatedOrder = await prisma.order.update({
      where: { order_id: orderId },
      data: { taker_customer_id: takerId },
    });

    res.status(200).json({
      message: 'Taker hold invoice created/fetched successfully',
      order: updatedOrder,
      holdInvoice,
    });
  } catch (error) {
    if (error.message.includes('Taker invoice for order id')) {
      console.log(`[API] ${error.message}`);
      return res.status(409).json({ error: error.message });
    }
    console.error('[API] Error creating/fetching taker hold invoice:', error);
    res.status(500).json({ error: 'Failed to create/fetch taker hold invoice', details: error.message });
  }
});

async function createTakerHoldInvoice(orderId: number, amount_msat: number, description: string) {
  console.log(`[createTakerHoldInvoice] Starting for orderId: ${orderId}`);

  return await prisma.$transaction(async (prisma) => {
    // Check for existing invoice within the transaction
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        order_id: orderId,
        user_type: 'taker',
        invoice_type: 'hold',
        status: { in: ['pending', 'unpaid'] }
      }
    });

    if (existingInvoice) {
      console.log(`[createTakerHoldInvoice] Existing hold invoice found for order ${orderId}`);
      return existingInvoice;
    }

    console.log(`[createTakerHoldInvoice] No existing invoice found. Creating new invoice for order ${orderId}`);

    const timestamp = Date.now();
    const label = `taker_hold_${orderId}_${timestamp}`;

    // Create a placeholder invoice in the database
    const placeholderInvoice = await prisma.invoice.create({
      data: {
        order_id: orderId,
        bolt11: 'placeholder',
        amount_msat: BigInt(amount_msat),
        description: description,
        status: 'pending',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3600000), // 1 hour from now, will be updated
        payment_hash: 'placeholder',
        invoice_type: 'hold',
        user_type: 'taker',
      },
    });

    console.log(`[createTakerHoldInvoice] Placeholder invoice created in database:`, {
      invoice_id: placeholderInvoice.invoice_id,
    });

    // Now create the invoice on the Lightning node
    try {
      const response = await axios.post(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
        amount_msat,
        label,
        description
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

      // Update the placeholder invoice with the real data
      const updatedInvoice = await prisma.invoice.update({
        where: { invoice_id: placeholderInvoice.invoice_id },
        data: {
          bolt11: response.data.bolt11,
          payment_hash: response.data.payment_hash,
          expires_at: new Date(response.data.expires_at * 1000),
        },
      });

      console.log(`[createTakerHoldInvoice] Invoice updated with Lightning node data:`, {
        invoice_id: updatedInvoice.invoice_id,
        payment_hash: updatedInvoice.payment_hash,
      });

      return updatedInvoice;
    } catch (error) {
      console.error(`[createTakerHoldInvoice] Error creating taker hold invoice:`, error);
      // If an error occurs, the transaction will be rolled back automatically
      throw error;
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable // Highest isolation level
  });
}

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working' });
});

