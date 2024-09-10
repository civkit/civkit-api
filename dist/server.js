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
import { postHoldinvoice, holdInvoiceLookup, syncInvoicesWithNode, syncPayoutsWithNode, handleFiatReceived, settleHoldInvoicesByOrderIdService, fullInvoiceLookup } from './services/invoiceService.js';
import { registerUser, authenticateUser, pollAndCompleteRegistration } from './services/userService.js';
import orderRoutes from './routes/orderRoutes.js';
import payoutsRoutes from './routes/payoutRoutes.js';
import settleRoutes from './routes/settleRoutes.js';
import { initializeNDK } from './config/ndkSetup.js';
import { checkAndCreateChatroom, updateAcceptOfferUrl } from './services/chatService.js';
import dotenv from 'dotenv';
import submitToMainstayRoutes from './routes/submitToMainstay.js';
import { PrismaClient, Prisma } from '@prisma/client';
import axios from 'axios';
import https from 'node:https';
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();
const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const RUNE = process.env.RUNE;
console.log('LIGHTNING_NODE_API_URL:', LIGHTNING_NODE_API_URL);
console.log('RUNE:', RUNE);
if (!LIGHTNING_NODE_API_URL || !RUNE) {
    console.error('Missing required environment variables. Please check your .env file.');
    process.exit(1);
}
const agent = new https.Agent({
    rejectUnauthorized: false
});
app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3001',
    methods: 'GET,POST,PUT,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true,
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
                password: user.password,
                created_at: user.created_at,
                invoice: user.invoice,
            },
            invoice: user.invoice // Display the invoice to register
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
    console.log('Received request at /api/holdinvoice');
    console.log('Request body:', req.body);
    try {
        const { amount_msat, label, description } = req.body;
        console.log('Extracted values:', { amount_msat, label, description });
        const result = yield postHoldinvoice(amount_msat, label, description);
        console.log('postHoldinvoice result:', result);
        res.json(result);
    }
    catch (error) {
        console.error('Error in /api/holdinvoice:', error);
        res.status(500).json({ error: error.message });
    }
}));
app.post('/api/holdinvoicelookup', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { payment_hash } = req.body;
    if (!payment_hash) {
        return res.status(400).json({ error: 'Payment hash is required' });
    }
    try {
        const result = yield holdInvoiceLookup(payment_hash);
        res.json(result);
    }
    catch (error) {
        console.error('Error in /api/holdinvoicelookup:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
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
    const userId = req.user.id;
    try {
        // Fetch the order details
        const order = yield prisma.order.findUnique({
            where: { order_id: parseInt(orderId) },
        });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        // Check if the user is the maker or taker of the order
        if (order.customer_id !== userId && order.taker_customer_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to access this chatroom' });
        }
        // Proceed to create or check chatroom
        const { makeOfferUrl, acceptOfferUrl } = yield checkAndCreateChatroom(orderId);
        res.status(200).json({ makeChatUrl: makeOfferUrl, acceptChatUrl: acceptOfferUrl });
    }
    catch (error) {
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
        const orders = yield prisma.order.findMany();
        res.status(200).json(orders);
    }
    catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
}));
//Get order by ID
app.get('/api/orders/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const order = yield prisma.order.findUnique({
            where: {
                order_id: parseInt(orderId)
            }
        });
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.status(200).json(order);
    }
    catch (err) {
        console.error('Error fetching order:', err);
        res.status(500).json({ error: 'An error occurred while fetching the order' });
    }
}));
// Get invoice by order ID
app.get('/api/invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const invoices = yield prisma.invoice.findMany({
            where: {
                order_id: parseInt(orderId)
            }
        });
        if (!invoices || invoices.length === 0) {
            return res.status(404).json({ error: 'Invoice not found' });
        }
        // Convert BigInt fields to strings
        const serializedInvoices = invoices.map(invoice => (Object.assign(Object.assign({}, invoice), { amount_msat: invoice.amount_msat.toString(), amount_received_msat: invoice.amount_received_msat ? invoice.amount_received_msat.toString() : null, created_at: invoice.created_at.toISOString(), expires_at: invoice.expires_at.toISOString(), paid_at: invoice.paid_at ? invoice.paid_at.toISOString() : null })));
        res.status(200).json(serializedInvoices);
    }
    catch (err) {
        console.error('Error fetching invoice:', err);
        res.status(500).json({ error: 'An error occurred while fetching the invoice' });
    }
}));
app.get('/api/taker-invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    try {
        const invoices = yield prisma.invoice.findMany({
            where: {
                order_id: parseInt(orderId),
                user_type: 'taker'
            }
        });
        if (invoices.length === 0) {
            return res.status(404).json({ error: 'Taker invoice not found' });
        }
        // Convert BigInt fields to strings for JSON serialization
        const serializedInvoices = invoices.map(invoice => (Object.assign(Object.assign({}, invoice), { amount_msat: invoice.amount_msat.toString(), amount_received_msat: invoice.amount_received_msat ? invoice.amount_received_msat.toString() : null, created_at: invoice.created_at.toISOString(), expires_at: invoice.expires_at.toISOString(), paid_at: invoice.paid_at ? invoice.paid_at.toISOString() : null })));
        res.status(200).json(serializedInvoices);
    }
    catch (err) {
        console.error('Error fetching taker invoice:', err);
        res.status(500).json({ error: 'An error occurred while fetching the taker invoice' });
    }
}));
app.get('/api/full-invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { orderId } = req.params;
    console.log(`Fetching full invoice for orderId: ${orderId}`);
    try {
        const invoice = yield prisma.invoice.findFirst({
            where: {
                order_id: parseInt(orderId),
                invoice_type: 'full'
            }
        });
        console.log('Found invoice:', invoice);
        if (!invoice) {
            console.log('No full invoice found for this order');
            return res.status(404).json({ error: 'Full invoice not found for this order' });
        }
        console.log('Looking up invoice status for payment_hash:', invoice.payment_hash);
        const invoiceStatus = yield fullInvoiceLookup(invoice.payment_hash);
        console.log('Invoice status from Lightning node:', invoiceStatus);
        // Update the invoice status if it's paid
        if (invoiceStatus.status === 'paid' && invoice.status !== 'paid') {
            yield prisma.invoice.update({
                where: { invoice_id: invoice.invoice_id },
                data: { status: 'paid' }
            });
            console.log(`Updated invoice ${invoice.invoice_id} status to paid`);
        }
        // Refresh the invoice data
        const updatedInvoice = yield prisma.invoice.findUnique({
            where: { invoice_id: invoice.invoice_id }
        });
        // Convert BigInt to String for JSON serialization
        const serializedInvoice = Object.assign(Object.assign({}, updatedInvoice), { amount_msat: updatedInvoice.amount_msat.toString(), amount_received_msat: updatedInvoice.amount_received_msat ? updatedInvoice.amount_received_msat.toString() : null, created_at: (_a = updatedInvoice.created_at) === null || _a === void 0 ? void 0 : _a.toISOString(), expires_at: (_b = updatedInvoice.expires_at) === null || _b === void 0 ? void 0 : _b.toISOString() });
        res.status(200).json({ invoice: serializedInvoice, lightningStatus: invoiceStatus });
    }
    catch (err) {
        console.error('Error fetching full invoice:', err);
        res.status(500).json({ error: 'An error occurred while fetching the full invoice' });
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
        const user = yield prisma.user.findUnique({
            where: { username },
            select: {
                invoice: true,
                payment_hash: true,
                status: true,
            },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const { invoice, payment_hash, status } = user;
        res.status(200).json({ invoice, payment_hash, status });
    }
    catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}));
app.use('/api', submitToMainstayRoutes);
console.log('Registering /api/taker-invoice/:orderId route');
app.post('/api/taker-invoice/:orderId', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Received request for taker invoice:', req.params.orderId);
    const orderId = parseInt(req.params.orderId);
    const takerId = req.user.id;
    try {
        const order = yield prisma.order.findUnique({
            where: { order_id: orderId },
        });
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        const holdInvoice = yield createTakerHoldInvoice(orderId, order.amount_msat, `Taker hold invoice for Order ${orderId}`);
        const updatedOrder = yield prisma.order.update({
            where: { order_id: orderId },
            data: {
                taker_customer_id: takerId,
                status: 'taker_found'
            },
        });
        res.status(200).json(serializeBigInt({
            message: 'Taker hold invoice created successfully',
            order: updatedOrder,
            holdInvoice,
        }));
    }
    catch (error) {
        console.error('[API] Error creating taker hold invoice:', error);
        res.status(500).json({ error: 'Failed to create taker hold invoice', details: error.message });
    }
}));
export function createTakerHoldInvoice(orderId, amount_msat, description) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(` [createTakerHoldInvoice] Starting for orderId: ${orderId}`);
        // Add this line to calculate 5%
        const holdAmount = Math.floor(amount_msat * 0.05);
        return yield prisma.$transaction((prisma) => __awaiter(this, void 0, void 0, function* () {
            // Check for existing invoice within the transaction
            const existingInvoice = yield prisma.invoice.findFirst({
                where: {
                    order_id: orderId,
                    user_type: 'taker',
                    invoice_type: 'hold',
                }
            });
            if (existingInvoice) {
                console.log(`[createTakerHoldInvoice] Existing hold invoice found for order ${orderId}`);
                return existingInvoice;
            }
            console.log(`[createTakerHoldInvoice] No existing invoice found. Creating new invoice for order ${orderId}`);
            const timestamp = Date.now();
            const label = `taker_hold_${orderId}_${timestamp}`;
            // Now create the hold invoice on the Lightning node
            try {
                const response = yield axios.post(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
                    amount_msat: holdAmount, // Use holdAmount instead of amount_msat
                    label,
                    description,
                    cltv: 144,
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Rune': RUNE
                    },
                    httpsAgent: agent
                });
                console.log(`[createTakerHoldInvoice] Lightning node response:`, response.data);
                if (!response.data || !response.data.bolt11 || !response.data.payment_hash) {
                    throw new Error('Invalid response from Lightning Node API: ' + JSON.stringify(response.data));
                }
                // Create the invoice in the database with the real data
                const newInvoice = yield prisma.invoice.create({
                    data: {
                        order_id: orderId,
                        bolt11: response.data.bolt11,
                        amount_msat: BigInt(amount_msat),
                        description: description,
                        status: 'unpaid',
                        created_at: new Date(),
                        expires_at: new Date(response.data.expires_at * 1000),
                        payment_hash: response.data.payment_hash,
                        invoice_type: 'hold',
                        user_type: 'taker',
                    },
                });
                console.log(`[createTakerHoldInvoice] Invoice created in database:`, {
                    invoice_id: newInvoice.invoice_id,
                    payment_hash: newInvoice.payment_hash,
                });
                return newInvoice;
            }
            catch (error) {
                console.error(`[createTakerHoldInvoice] Error creating taker hold invoice:`, error);
                throw error;
            }
        }), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        });
    });
}
function serializeBigInt(data) {
    if (typeof data === 'bigint') {
        return data.toString();
    }
    else if (Array.isArray(data)) {
        return data.map(serializeBigInt);
    }
    else if (typeof data === 'object' && data !== null) {
        return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, serializeBigInt(value)]));
    }
    return data;
}
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working' });
});
