// server.js
import express from 'express';
import dotenv from 'dotenv';
import { authenticateJWT } from './middleware/authMiddleware.js';
import { generateToken } from './utils/auth.js';
import {
  postHoldinvoice,
  holdInvoiceLookup,
  syncInvoicesWithNode,
  syncPayoutsWithNode,
  handleFiatReceived,
  settleHoldInvoiceByHash,
  settleHoldInvoicesByOrderIdService
} from './services/invoiceService.js';
import { registerUser, authenticateUser } from './services/userService.js';
import orderRoutes from './routes/orderRoutes.js';
import payoutsRoutes from './routes/payouts.js';
import { initializeNDK } from './config/ndkSetup.js';  // Adjusted import

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await registerUser(username, password);
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await authenticateUser(username, password);
    const token = generateToken(user);
    res.json({ token });
  } catch (error) {
    res.status(401).json({ message: 'Login failed', error: error.message });
  }
});

// Protected Routes
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

app.use('/api/order', authenticateJWT, orderRoutes);
app.use('/api/payouts', authenticateJWT, payoutsRoutes);
app.use('/api/orders', authenticateJWT, orderRoutes);

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

// Initialize NDK and create identity
initializeNDK().then(() => {
  // Start the Express server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
