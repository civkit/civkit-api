const express = require('express');
const router = express.Router();
const { postHoldinvoice, holdInvoiceLookup } = require('../services/invoiceService');

router.post('/create-hold-invoice', async (req: any, res: any) => {
  try {
    const invoice = await postHoldinvoice(req.body.amount_msat, req.body.label, req.body.description);
    res.status(201).json(invoice);
  } catch (error) {
    console.error('API call to create hold invoice failed:', error);
    res.status(500).json({ error: 'Failed to create hold invoice' });
  }
});

router.post('/lookup-hold-invoice', async (req: any, res: any) => {
  try {
    const status = await holdInvoiceLookup(req.body.payment_hash);
    res.status(200).json(status);
  } catch (error) {
    console.error('API call to lookup hold invoice failed:', error);
    res.status(500).json({ error: 'Failed to lookup invoice' });
  }
});

router.get('/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { type } = req.query; // Get the invoice type from query parameter

  try {
    // Use Prisma to query the invoice
    const invoice = await prisma.invoice.findFirst({
      where: {
        order_id: parseInt(orderId, 10),
        invoice_type: type as string, // Cast type to string
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Convert BigInt fields to strings for JSON serialization
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



module.exports = router;
