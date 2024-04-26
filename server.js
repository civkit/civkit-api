import express from 'express';
import { postHoldinvoice, holdInvoiceLookup } from './services/invoiceService.js';
import orderRoutes from './routes/orderRoutes.js'; // Ensure this import is correct

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
