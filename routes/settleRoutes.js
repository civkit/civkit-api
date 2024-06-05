import express from 'express';
import { settleHoldInvoices } from '../services/invoiceService.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/settle-hold-invoices', authenticateJWT, async (req, res) => {
  try {
    const { orderId } = req.body;
    const result = await settleHoldInvoices(orderId);
    res.status(200).json({ message: 'Hold invoices settled successfully', result });
  } catch (error) {
    res.status(500).json({ message: 'Error settling hold invoices', error: error.message });
  }
});

export default router;
