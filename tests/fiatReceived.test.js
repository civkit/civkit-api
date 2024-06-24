const request = require('supertest');
const express = require('express');
const { handleFiatReceived } = require('../services/invoiceService');
const { authenticateJWT } = require('../middleware/authMiddleware');

const app = express();
app.use(express.json());

app.post('/api/fiat-received', authenticateJWT, async (req, res) => {
    try {
        const { order_id } = req.body;
        await handleFiatReceived(order_id);
        res.status(200).json({ message: 'Fiat received processed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error processing fiat received', error: error.message });
    }
});

jest.mock('../services/invoiceService', () => ({
    handleFiatReceived: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    authenticateJWT: (req, res, next) => next(),
}));

describe('POST /api/fiat-received', () => {
    it('should process fiat received successfully', async () => {
        handleFiatReceived.mockResolvedValue();

        const response = await request(app)
            .post('/api/fiat-received')
            .send({ order_id: 1 });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Fiat received processed successfully');
    });

    it('should return 500 if processing fails', async () => {
        handleFiatReceived.mockRejectedValue(new Error('Processing failed'));

        const response = await request(app)
            .post('/api/fiat-received')
            .send({ order_id: 1 });

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('message', 'Error processing fiat received');
    });
});
