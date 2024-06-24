const request = require('supertest');
const express = require('express');
const { checkAndCreateChatroom } = require('../services/chatService');
const { authenticateJWT } = require('../middleware/authMiddleware');
const { query } = require('../config/db');

const app = express();
app.use(express.json());

jest.mock('../services/chatService', () => ({
    checkAndCreateChatroom: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    authenticateJWT: (req, res, next) => {
        req.user = { id: 1 }; // Mock user
        next();
    },
}));

jest.mock('../config/db', () => ({
    query: jest.fn(),
}));

app.post('/api/check-and-create-chatroom', authenticateJWT, async (req, res) => {
    const { orderId } = req.body;
    const userId = req.user.id;

    try {
        const orderResult = await query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const order = orderResult.rows[0];
        if (order.customer_id !== userId && order.taker_customer_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to access this chatroom' });
        }

        const { makeOfferUrl, acceptOfferUrl } = await checkAndCreateChatroom(orderId);
        res.status(200).json({ makeChatUrl: makeOfferUrl, acceptChatUrl: acceptOfferUrl });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create chatroom', error: error.message });
    }
});

describe('POST /api/check-and-create-chatroom', () => {
    beforeEach(() => {
        query.mockReset();
        checkAndCreateChatroom.mockReset();
    });

    it('should create or return existing chatroom', async () => {
        const order = { order_id: 1, customer_id: 1, taker_customer_id: 2 };
        query.mockResolvedValue({ rows: [order] });
        checkAndCreateChatroom.mockResolvedValue({ makeOfferUrl: 'makeUrl', acceptOfferUrl: 'acceptUrl' });

        const response = await request(app)
            .post('/api/check-and-create-chatroom')
            .send({ orderId: 1 });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('makeChatUrl', 'makeUrl');
        expect(response.body).toHaveProperty('acceptChatUrl', 'acceptUrl');
    });

    it('should return 404 if order not found', async () => {
        query.mockResolvedValue({ rows: [] });

        const response = await request(app)
            .post('/api/check-and-create-chatroom')
            .send({ orderId: 1 });

        expect(response.status).toBe(404);
        expect(response.body).toHaveProperty('message', 'Order not found');
    });

    it('should return 403 if user not authorized', async () => {
        const order = { order_id: 1, customer_id: 3, taker_customer_id: 4 };
        query.mockResolvedValue({ rows: [order] });

        const response = await request(app)
            .post('/api/check-and-create-chatroom')
            .send({ orderId: 1 });

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty('message', 'You are not authorized to access this chatroom');
    });

    it('should return 500 if creation fails', async () => {
        const order = { order_id: 1, customer_id: 1, taker_customer_id: 2 };
        query.mockResolvedValue({ rows: [order] });
        checkAndCreateChatroom.mockRejectedValue(new Error('Chatroom creation failed'));

        const response = await request(app)
            .post('/api/check-and-create-chatroom')
            .send({ orderId: 1 });

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('message', 'Failed to create chatroom');
    });
});
