const request = require('supertest');
const express = require('express');
const { syncPayoutsWithNode } = require('../services/invoiceService');
const { authenticateJWT } = require('../middleware/authMiddleware');

const app = express();
app.use(express.json());

app.get('/api/sync-payouts', authenticateJWT, async (req, res) => {
    try {
        await syncPayoutsWithNode();
        res.status(200).json({ message: 'Payouts synchronized successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to synchronize payouts', error: error.message });
    }
});

jest.mock('../services/invoiceService', () => ({
    syncPayoutsWithNode: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    authenticateJWT: (req, res, next) => next(),
}));

describe('GET /api/sync-payouts', () => {
    it('should synchronize payouts successfully', async () => {
        syncPayoutsWithNode.mockResolvedValue();

        const response = await request(app)
            .get('/api/sync-payouts')
            .send();

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Payouts synchronized successfully');
    });

    it('should return 500 if synchronization fails', async () => {
        syncPayoutsWithNode.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app)
            .get('/api/sync-payouts')
            .send();

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('message', 'Failed to synchronize payouts');
    });
});
