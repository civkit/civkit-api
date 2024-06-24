const request = require('supertest');
const express = require('express');
const { postHoldinvoice } = require('../services/invoiceService');
const { authenticateJWT } = require('../middleware/authMiddleware');

const app = express();
app.use(express.json());

app.post('/api/holdinvoice', authenticateJWT, async (req, res) => {
    try {
        const { amount_msat, label, description } = req.body;
        const result = await postHoldinvoice(amount_msat, label, description);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

jest.mock('../services/invoiceService', () => ({
    postHoldinvoice: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    authenticateJWT: (req, res, next) => next(),
}));

describe('POST /api/holdinvoice', () => {
    it('should create a hold invoice', async () => {
        const invoice = { invoice: 'fakeInvoice' };
        postHoldinvoice.mockResolvedValue(invoice);

        const response = await request(app)
            .post('/api/holdinvoice')
            .send({ amount_msat: 1000, label: 'test', description: 'test description' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('invoice', 'fakeInvoice');
    });

    it('should return 500 if creating invoice fails', async () => {
        postHoldinvoice.mockRejectedValue(new Error('Invoice creation failed'));

        const response = await request(app)
            .post('/api/holdinvoice')
            .send({ amount_msat: 1000, label: 'test', description: 'test description' });

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error', 'Invoice creation failed');
    });
});
