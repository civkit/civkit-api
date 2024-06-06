const express = require('express');
const router = express.Router();
const { postHoldinvoice, holdInvoiceLookup } = require('../services/invoiceService');

router.post('/create-hold-invoice', async (req, res) => {
  try {
    const invoice = await postHoldinvoice(req.body.amount_msat, req.body.label, req.body.description);
    res.status(201).json(invoice);
  } catch (error) {
    console.error('API call to create hold invoice failed:', error);
    res.status(500).json({ error: 'Failed to create hold invoice' });
  }
});

router.post('/lookup-hold-invoice', async (req, res) => {
  try {
    const status = await holdInvoiceLookup(req.body.payment_hash);
    res.status(200).json(status);
  } catch (error) {
    console.error('API call to lookup hold invoice failed:', error);
    res.status(500).json({ error: 'Failed to lookup invoice' });
  }
});

router.get('/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const { type } = req.query; // Get the invoice type from query parameter
  try {
    const result = await query('SELECT * FROM invoices WHERE order_id = $1 AND invoice_type = $2', [orderId, type]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
