var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import express from 'express';
import cors from 'cors';
import { authenticateJWT } from './middleware/authMiddleware.js';
import { generateToken } from './utils/auth.js';
import { postHoldinvoice, holdInvoiceLookup, syncInvoicesWithNode, syncPayoutsWithNode, handleFiatReceived, settleHoldInvoicesByOrderIdService, } from './services/invoiceService.js';
import { registerUser, authenticateUser, pollAndCompleteRegistration } from './services/userService.js';
import orderRoutes from './routes/orderRoutes.js';
import payoutsRoutes from './routes/payoutRoutes.js';
import settleRoutes from './routes/settleRoutes.js';
import { initializeNDK } from './config/ndkSetup.js';
import { checkAndCreateChatroom, updateAcceptOfferUrl } from './services/chatService.js';
import { query, pool } from './config/db.js';
import dotenv from 'dotenv';
import submitToMainstayRoutes from './routes/submitToMainstay.js';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3001',
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
}));
app.post('/api/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username, password } = req.body;
    try {
        const user = yield registerUser(username, password);
        res.status(201).json({
            message: 'Registration initiated, please pay the invoice to complete registration.',
            user: {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                invoice: user.invoice
            },
            invoice: user.invoice // Display the invoice to regidster
        });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Registration failed', error: error.message });
    }
}));
// polls invoices to see if registration is complete
setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield pollAndCompleteRegistration();
    }
    catch (error) {
        console.error('Error during registration polling:', error);
    }
}), 20000); // 20 seconds
// User Login
app.post('/api/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, password } = req.body;
        const user = yield authenticateUser(username, password);
        const token = generateToken(user);
        res.json({ token });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(401).json({ message: 'Login failed', error: error.message });
    }
}));
app.post('/api/holdinvoice', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { amount_msat, label, description } = req.body;
        const result = yield postHoldinvoice(amount_msat, label, description);
        res.json(result);
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: error.message });
    }
}));
app.post('/api/holdinvoicelookup', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield holdInvoiceLookup(req.body.payment_hash);
        res.json(result);
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: error.message });
    }
}));
app.use('/api/orders', authenticateJWT, orderRoutes);
app.use('/api/payouts', authenticateJWT, payoutsRoutes);
app.post('/api/sync-invoices', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield syncInvoicesWithNode();
        res.status(200).json({ message: 'Invoices synchronized successfully' });
    }
    catch (error) {
        console.error('Failed to sync invoices:', error);
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Failed to synchronize invoices', error: error.message });
    }
}));
app.get('/api/sync-payouts', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield syncPayoutsWithNode();
        res.status(200).json({ message: 'Payouts synchronized successfully' });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Failed to synchronize payouts', error: error.message });
    }
}));
app.post('/api/fiat-received', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { order_id } = req.body;
        yield handleFiatReceived(order_id);
        res.status(200).json({ message: 'Fiat received processed successfully' });
    }
    catch (error) {
        console.error('Error processing fiat received:', error);
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Error processing fiat received', error: error.message });
    }
}));
app.post('/api/settle-holdinvoices-by-order', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { orderId } = req.body;
        const result = yield settleHoldInvoicesByOrderIdService(orderId);
        res.status(200).json({ message: 'Hold invoices settled successfully', result });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Error settling hold invoices', error: error.message });
    }
}));
// Initialize NDK and create identity
initializeNDK().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
app.post('/api/check-accepted-invoices', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // @ts-expect-error TS(2304): Cannot find name 'checkAndUpdateAcceptedInvoices'.
        yield checkAndUpdateAcceptedInvoices();
        res.status(200).send({ message: 'Invoices checked and updated successfully.' });
    }
    catch (error) {
        res.status(500).send({ error: 'Failed to check and update invoices' });
    }
}));
app.post('/api/check-and-create-chatroom', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.body;
    // @ts-expect-error TS(2339): Property 'user' does not exist on type 'Request<{}... Remove this comment to see the full error message
    const userId = req.user.id; // Assuming `req.user` contains the authenticated user's details
    try {
        // Fetch the order details
        const orderResult = yield query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const order = orderResult.rows[0];
        console.log('Order details:', order);
        console.log('User ID:', userId);
        // Check if the user is the maker or taker of the order
        // @ts-expect-error TS(2339): Property 'customer_id' does not exist on type 'any... Remove this comment to see the full error message
        if (order.customer_id !== userId && order.taker_customer_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to access this chatroom' });
        }
        // Proceed to create or check chatroom
        // @ts-expect-error TS(2339): Property 'makeOfferUrl' does not exist on type '{ ... Remove this comment to see the full error message
        const { makeOfferUrl, acceptOfferUrl } = yield checkAndCreateChatroom(orderId);
        res.status(200).json({ makeChatUrl: makeOfferUrl, acceptChatUrl: acceptOfferUrl });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Failed to create chatroom', error: error.message });
    }
}));
// Endpoint to update accept-offer URL
app.post('/api/update-accept-offer-url', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { chat_id, accept_offer_url } = req.body;
        yield updateAcceptOfferUrl(chat_id, accept_offer_url);
        res.status(200).json({ message: 'Accept-offer URL updated successfully' });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Failed to update accept-offer URL', error: error.message });
    }
}));
app.use('/api/settle', settleRoutes);
// Get all orders
app.get('/api/orders', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
        const result = yield query('SELECT * FROM orders');
        res.status(200).json(result.rows);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
//Get order by ID
app.get('/api/orders/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const result = yield query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
// Get invoice by order ID
app.get('/api/invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const result = yield query('SELECT * FROM invoices WHERE order_id = $1', [orderId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
app.get('/api/taker-invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const result = yield query('SELECT * FROM invoices WHERE order_id = $1 AND user_type = $2', [orderId, 'taker']);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Taker invoice not found' });
        }
        res.status(200).json(result.rows);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
app.get('/api/full-invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const result = yield query('SELECT * FROM invoices WHERE order_id = $1 AND invoice_type = $2', [parseInt(orderId, 10), 'full']);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Full invoice not found' });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
// endpoint to lookup full invoice by payment hash
app.post('/api/fullinvoicelookup', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { payment_hash } = req.body;
    try {
        const result = yield query('SELECT * FROM invoices WHERE payment_hash = $1 AND invoice_type = $2', [payment_hash, 'full']);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Full invoice not found' });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (err) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: err.message });
    }
}));
// Call this function periodically
setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield pollAndCompleteRegistration();
    }
    catch (error) {
        console.error('Error during registration polling:', error);
    }
}), 20000); // 20 seconds interval
app.post('/api/get-invoice', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }
    try {
        const query = 'SELECT invoice, payment_hash, status FROM users WHERE username = $1';
        const values = [username];
        const { rows } = yield pool.query(query, values);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { invoice, payment_hash, status } = rows[0];
        res.status(200).json({ invoice, payment_hash, status });
    }
    catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
app.use('/api', submitToMainstayRoutes);
