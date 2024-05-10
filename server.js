import express from 'express';
import { postHoldinvoice, holdInvoiceLookup, syncInvoicesWithNode, syncPayoutsWithNode, handleFiatReceived, settleHoldInvoiceByHash } from './services/invoiceService.js';
import orderRoutes from './routes/orderRoutes.js'; // Ensure this import is correct
import payoutsRoutes from './routes/payouts.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Route for handling hold invoice creation
app.post('/api/holdinvoice', async (req, res) => {
  try {
    const result = await postHoldinvoice(req.body.amount_msat, req.body.label, req.body.description);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route for handling hold invoice lookup
app.post('/api/holdinvoicelookup', async (req, res) => {
  try {
    const result = await holdInvoiceLookup(req.body.payment_hash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route for handling order creation
app.use('/api/order', orderRoutes); // Make sure you use app.use here to properly mount the route

app.use('/api/payouts', payoutsRoutes);
app.use('/api/orders', orderRoutes);


app.post('/api/sync-invoices', async (req, res) => {
  try {
    await syncInvoicesWithNode();
    res.status(200).json({ message: 'Invoices synchronized successfully' });
  } catch (error) {
    console.error('Failed to sync invoices:', error);
    res.status(500).json({ message: 'Failed to synchronize invoices', error: error.message });
  }
});


app.get('/api/sync-payouts', async (req, res) => {
  try {
    await syncPayoutsWithNode();
    res.status(200).json({ message: 'Payouts synchronized successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to synchronize payouts', error: error.message });
  }
});

// Function to handle 'fiat received'
app.post('/api/fiat-received', async (req, res) => {
  try {
    const { order_id } = req.body;
    // Assuming you have a function called handleFiatReceived in your invoice service
    await handleFiatReceived(order_id);
    res.status(200).json({ message: 'Fiat received processed successfully' });
  } catch (error) {
    console.error('Error processing fiat received:', error);
    res.status(500).json({ message: 'Error processing fiat received', error: error.message });
  }
});


// Function to handle 'settle hold invoice' by payment hash
app.post('/api/settle-holdinvoice', async (req, res) => {
  try {
    const { payment_hash } = req.body;
    const result = await settleHoldInvoiceByHash(payment_hash);
    res.status(200).json({ message: 'Hold invoice settled successfully', result });
  } catch (error) {
    console.error('Error settling hold invoice:', error);
    res.status(500).json({ message: 'Error settling hold invoice', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
