const request = require('supertest');
const express = require('express');
const { syncInvoicesWithNode } = require('../services/invoiceService');
const { authenticateJWT } = require('../middleware/authMiddleware');

const app = express();
app.use(express.json());

app.post('/api/sync-invoices', authenticateJWT, async (req, res) => {
    try {
        await syncInvoicesWithNode();
        res.status(200).json({ message: 'Invoices synchronized successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to synchronize invoices', error: error.message });
    }
});

jest.mock('../services/invoiceService', () => ({
    syncInvoicesWithNode: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    authenticateJWT: (req, res, next) => next(),
}));

describe('POST /api/sync-invoices', () => {
    it('should synchronize invoices successfully', async () => {
        syncInvoicesWithNode.mockResolvedValue();

        const response = await request(app)
            .post('/api/sync-invoices')
            .send();

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Invoices synchronized successfully');
    });

    it('should return 500 if synchronization fails', async () => {
        syncInvoicesWithNode.mockRejectedValue(new Error('Sync failed'));

        const response = await request(app)
            .post('/api/sync-invoices')
            .send();

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('message', 'Failed to synchronize invoices');
    });
});
