import express from 'express';
import { createOrder, takeOrder } from '../controllers/orderController.js';
import { settleHoldInvoicesByOrderIdService } from '../services/invoiceService.js';

const router = express.Router();

router.post('/', createOrder);
router.post('/take', takeOrder);  // New endpoint for taking an order

router.post('/settle-holdinvoices-by-order', async (req, res) => {
  const { orderId } = req.body;

  try {
    await settleHoldInvoicesByOrderIdService(orderId);
    res.status(200).json({ message: 'Successfully settled hold invoices for the order' });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    res.status(500).json({ error: error.message });
  }
});


export default router;
