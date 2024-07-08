var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import fetch from 'node-fetch';
import https from 'https';
import { config } from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
config(); // This line configures dotenv to load the environment variables
const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const MY_RUNE = process.env.RUNE;
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    // @ts-expect-error TS(2322): Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
    port: process.env.DB_PORT,
});
// creates the hold invoice and 
function postHoldinvoice(totalAmountMsat, label, description) {
    return __awaiter(this, void 0, void 0, function* () {
        const amount_msat = Math.round(totalAmountMsat * 0.05); // Calculate 5% of the total amount
        const data = {
            amount_msat,
            label,
            description,
            cltv: 770,
        };
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
                agent: new https.Agent({ rejectUnauthorized: false }),
            });
            if (!response.ok) {
                throw new Error(`Error: ${response.status}`);
            }
            return yield response.json();
        }
        catch (error) {
            console.error('Failed to post invoice:', error);
            throw error;
        }
    });
}
// looks up holdinvoices and returns status
function holdInvoiceLookup(payment_hash) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicelookup`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ payment_hash }),
                agent: new https.Agent({ rejectUnauthorized: false }),
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const invoiceData = yield response.json();
            console.log('Invoice Data:', invoiceData);
            return invoiceData;
        }
        catch (error) {
            console.error('Failed to lookup hold invoice:', error);
            throw error;
        }
    });
}
// syncs the invoice status from lightning with the database
function syncInvoicesWithNode() {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = new https.Agent({ rejectUnauthorized: false });
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                },
                agent
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const { invoices } = yield response.json();
            console.log('Fetched invoices from node:', invoices);
            const client = yield pool.connect();
            try {
                yield client.query('BEGIN');
                const orderUpdates = {};
                for (const invoice of invoices) {
                    console.log(`Processing invoice with payment_hash: ${invoice.payment_hash}`);
                    const res = yield client.query('SELECT status, order_id, invoice_type FROM invoices WHERE payment_hash = $1', [invoice.payment_hash]);
                    if (res.rows.length > 0) {
                        const { status, order_id, invoice_type } = res.rows[0];
                        let newStatus = invoice.status;
                        // Additional check for hold invoices
                        if (invoice_type === 'hold') {
                            console.log(`Checking hold invoice with payment_hash: ${invoice.payment_hash}`);
                            const holdState = yield holdInvoiceLookup(invoice.payment_hash);
                            console.log(`Hold state for invoice with payment_hash ${invoice.payment_hash}:`, holdState);
                            if (holdState.state === 'ACCEPTED' || holdState.state === 'settled') {
                                newStatus = 'ACCEPTED';
                            }
                            else if (holdState.state === 'canceled') {
                                newStatus = 'canceled';
                            }
                        }
                        if (status !== newStatus) {
                            console.log(`Updating invoice status for payment_hash ${invoice.payment_hash} from ${status} to ${newStatus}`);
                            yield client.query('UPDATE invoices SET status = $1 WHERE payment_hash = $2', [newStatus, invoice.payment_hash]);
                            console.log(`Invoice with payment_hash ${invoice.payment_hash} updated to status: ${newStatus}`);
                        }
                        else {
                            console.log(`Invoice with payment_hash ${invoice.payment_hash} already has status: ${newStatus}`);
                        }
                        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        if (!orderUpdates[order_id]) {
                            // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                            orderUpdates[order_id] = [];
                        }
                        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        orderUpdates[order_id].push(newStatus);
                    }
                    else {
                        console.log(`No matching record found in the database for invoice with payment_hash ${invoice.payment_hash}`);
                    }
                }
                for (const order_id in orderUpdates) {
                    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    const statuses = orderUpdates[order_id];
                    const allHoldInvoices = statuses.filter((status) => status === 'ACCEPTED').length === 2;
                    const fullInvoicePaid = statuses.includes('ACCEPTED');
                    if (allHoldInvoices && fullInvoicePaid) {
                        yield client.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['chat_open', order_id]);
                        console.log(`Order ${order_id} updated to chat_open`);
                    }
                    else {
                        console.log(`Order ${order_id} does not meet the criteria for chat_open`);
                    }
                }
                yield client.query('COMMIT');
            }
            catch (error) {
                console.error('Error while syncing invoices:', error);
                yield client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('Error fetching invoices from node:', error);
            throw error;
        }
    });
}
// syncs payouts with node. 
// not sure where this is used so worth investigating if still needed or replaced by above
function syncPayoutsWithNode() {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });
        const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
            method: 'POST',
            // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
            headers: {
                'Accept': 'application/json',
                'Rune': MY_RUNE,
            },
            agent
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        const { invoices } = yield response.json();
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            for (const invoice of invoices) {
                const ln_invoice = invoice.bolt11;
                const res = yield client.query('SELECT status FROM payouts WHERE ln_invoice = $1', [ln_invoice]);
                if (res.rows.length > 0 && res.rows[0].status !== invoice.status) {
                    yield client.query('UPDATE payouts SET status = $1 WHERE ln_invoice = $2', [invoice.status, ln_invoice]);
                    console.log(`Payout status updated for ln_invoice ${ln_invoice}`);
                }
            }
            yield client.query('COMMIT');
        }
        catch (error) {
            console.error('Error updating payout statuses:', error);
            yield client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function generateBolt11Invoice(amount_msat, label, description, type, premium) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {
            amount_msat: parseInt(amount_msat),
            label,
            description,
            cltv: 770,
            type,
            premium
        };
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
                agent: new https.Agent({ rejectUnauthorized: false }),
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const invoiceData = yield response.json();
            if (!invoiceData.bolt11) {
                console.error('Response missing bolt11:', invoiceData);
                throw new Error('bolt11 is missing in the response');
            }
            return invoiceData;
        }
        catch (error) {
            console.error('Error in generating Bolt11 invoice:', error);
            throw error;
        }
    });
}
function postFullAmountInvoice(amount_msat, label, description, orderId, orderType) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {
            amount_msat,
            label,
            description,
            cltv: 770,
        };
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
                agent: new https.Agent({ rejectUnauthorized: false })
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const invoiceData = yield response.json();
            if (!invoiceData.bolt11) {
                console.error('Response missing bolt11:', invoiceData);
                throw new Error('bolt11 is missing in the response');
            }
            console.log(`Full amount invoice created for order ${orderId}:`, invoiceData);
            return invoiceData;
        }
        catch (error) {
            console.error('Failed to post full amount invoice:', error);
            throw error;
        }
    });
}
function handleFiatReceived(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            yield client.query('BEGIN');
            const updateResult = yield updatePayoutStatus(client, orderId, 'fiat_received');
            if (updateResult.rowCount === 0) {
                throw new Error('No corresponding payout found or update failed');
            }
            const payoutDetails = yield client.query(`SELECT ln_invoice FROM payouts WHERE order_id = $1`, [orderId]);
            if (payoutDetails.rows.length === 0) {
                throw new Error('No payout details found for this order');
            }
            const payoutInvoice = payoutDetails.rows[0].ln_invoice;
            console.log("Payout LN Invoice:", payoutInvoice);
            const paymentResult = yield payInvoice(payoutInvoice);
            if (!paymentResult || paymentResult.status !== 'complete') {
                throw new Error('Failed to pay payout invoice');
            }
            console.log("Successfully paid payout invoice:", payoutInvoice);
            yield client.query('COMMIT');
            console.log("Fiat received and payout processed successfully.");
        }
        catch (error) {
            yield client.query('ROLLBACK');
            console.error("Error processing fiat received:", error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function payInvoice(lnInvoice) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/pay`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ bolt11: lnInvoice }),
                agent: new https.Agent({ rejectUnauthorized: false })
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            return yield response.json();
        }
        catch (error) {
            console.error('Failed to pay invoice:', error);
            throw error;
        }
    });
}
function updatePayoutStatus(client, orderId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield client.query('UPDATE payouts SET status = $1 WHERE order_id = $2 RETURNING *', [status, orderId]);
            if (result.rows.length === 0) {
                throw new Error('Failed to update payout status');
            }
            return result;
        }
        catch (error) {
            throw error;
        }
    });
}
function settleHoldInvoice(lnInvoice) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ payment_hash: lnInvoice }),
                agent: new https.Agent({ rejectUnauthorized: false })
            });
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            return yield response.json();
        }
        catch (error) {
            console.error('Failed to settle invoice:', error);
            throw error;
        }
    });
}
function checkAndProcessPendingPayouts() {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            const result = yield client.query("SELECT order_id FROM payouts WHERE status = 'fiat_received'");
            for (const row of result.rows) {
                yield handleFiatReceived(row.order_id);
            }
        }
        catch (error) {
            console.error('Error processing pending payouts:', error);
        }
        finally {
            client.release();
        }
    });
}
const settleHoldInvoiceByHash = (payment_hash) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log(`Settling hold invoice with payment_hash: ${payment_hash}`);
        const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicesettle`, {
            method: 'POST',
            // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
            headers: {
                'Accept': 'application/json',
                'Rune': MY_RUNE,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ payment_hash }),
            agent: new https.Agent({ rejectUnauthorized: false }),
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        const settleData = yield response.json();
        console.log('Settled hold invoice:', settleData);
        return settleData;
    }
    catch (error) {
        console.error('Error in settling hold invoice:', error);
        throw error;
    }
});
const settleHoldInvoicesByOrderIdService = (orderId) => __awaiter(void 0, void 0, void 0, function* () {
    const client = yield pool.connect();
    try {
        yield client.query('BEGIN');
        // Fetch all hold invoices for the order
        const invoicesResult = yield client.query('SELECT payment_hash FROM invoices WHERE order_id = $1 AND invoice_type = $2 AND status = $3', [orderId, 'hold', 'ACCEPTED']);
        const settlePromises = invoicesResult.rows.map((invoice) => __awaiter(void 0, void 0, void 0, function* () {
            const settleData = yield settleHoldInvoiceByHash(invoice.payment_hash);
            // Update the invoice status to 'settled' in the database
            yield client.query('UPDATE invoices SET status = $1 WHERE payment_hash = $2', ['settled', invoice.payment_hash]);
            return settleData;
        }));
        const settledInvoices = yield Promise.all(settlePromises);
        yield client.query('COMMIT');
        return settledInvoices;
    }
    catch (error) {
        yield client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
// generic chat functions that are not currently being used.
// placeholders for alerting users when their chatroom is open
function notifyUsers(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Chatroom is available for Order ID: ${orderId} for both Maker and Taker`);
    });
}
function handleChatroomTrigger(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        // @ts-expect-error TS(2304): Cannot find name 'generateChatId'.
        const chatId = generateChatId(orderId); // Replace with your chatroom logic
        //console.log(`Chatroom ID ${chatId} is created for Order ID: ${orderId}`);
        // Notify both users that the chatroom is available
        yield notifyUsers(orderId);
        return chatId;
    });
}
// chatroom code that hooks into the chat app and returns the chatroom when invoices are marked as paid for the orderId
const CHAT_APP_URL = 'http://localhost:3456';
function checkInvoicesAndCreateChatroom(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = new https.Agent({ rejectUnauthorized: false });
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                },
                agent
            });
            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} while fetching invoices`);
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const { invoices } = yield response.json();
            const client = yield pool.connect();
            try {
                yield client.query('BEGIN');
                const invoiceStatuses = yield client.query('SELECT payment_hash, status, invoice_type FROM invoices WHERE order_id = $1', [orderId]);
                const invoiceMap = new Map(invoiceStatuses.rows.map(row => [row.payment_hash, row]));
                let allHoldInvoices = true;
                let fullInvoicePaid = false;
                let holdCount = 0;
                for (const dbInvoice of invoiceMap.values()) {
                    const invoice = invoices.find((inv) => inv.payment_hash === dbInvoice.payment_hash);
                    if (!invoice) {
                        console.log(`Invoice with payment_hash ${dbInvoice.payment_hash} not found in Lightning node response`);
                        allHoldInvoices = false;
                        break;
                    }
                    console.log(`Checking invoice ${invoice.payment_hash} - dbStatus: ${dbInvoice.status}, apiStatus: ${invoice.status}, invoice_type: ${dbInvoice.invoice_type}`);
                    if (dbInvoice.invoice_type === 'full') {
                        if (invoice.status !== 'paid') {
                            console.log(`Full invoice with payment_hash ${dbInvoice.payment_hash} is not in paid status (apiStatus: ${invoice.status})`);
                            fullInvoicePaid = false;
                            allHoldInvoices = false;
                            break;
                        }
                        else {
                            fullInvoicePaid = true;
                        }
                    }
                    else if (dbInvoice.invoice_type === 'hold') {
                        if (invoice.status === 'hold') {
                            holdCount += 1;
                        }
                        else {
                            allHoldInvoices = false;
                        }
                    }
                    if (dbInvoice.status !== invoice.status) {
                        yield client.query('UPDATE invoices SET status = $1 WHERE payment_hash = $2 AND order_id = $3', [invoice.status, invoice.payment_hash, orderId]);
                        console.log(`Invoice with payment_hash ${invoice.payment_hash} updated to '${invoice.status}'`);
                    }
                }
                yield client.query('COMMIT');
                if (holdCount >= 2 && fullInvoicePaid) {
                    yield client.query('UPDATE orders SET status = $1 WHERE order_id = $2', ['chat_open', orderId]);
                    const chatroomUrl = yield createChatroom(orderId);
                    console.log(`Chatroom can be created for Order ID: ${orderId}. Redirect to: ${chatroomUrl}`);
                    return chatroomUrl;
                }
                else {
                    console.log(`allHoldInvoices: ${allHoldInvoices}, fullInvoicePaid: ${fullInvoicePaid}`);
                    console.log(`Not all invoices are in the required state for Order ID: ${orderId}`);
                    return null;
                }
            }
            catch (dbError) {
                yield client.query('ROLLBACK');
                console.error('Database transaction error:', dbError);
                throw dbError;
            }
            finally {
                client.release();
            }
        }
        catch (error) {
            console.error('Error checking and updating invoices:', error);
            throw error;
        }
    });
}
function createChatroom(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        return `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
    });
}
function updateOrderStatus(orderId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            const result = yield client.query('UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *', [status, orderId]);
            if (result.rows.length === 0) {
                throw new Error('Failed to update order status');
            }
            return result.rows[0];
        }
        catch (error) {
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function getHoldInvoicesByOrderId(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            const result = yield client.query('SELECT payment_hash FROM invoices WHERE order_id = $1 AND invoice_type = $2 AND status = $3', [orderId, 'hold', 'ACCEPTED']);
            return result.rows.map(row => row.payment_hash);
        }
        catch (error) {
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function settleHoldInvoices(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Update order status to 'trade_complete'
            yield updateOrderStatus(orderId, 'trade_complete');
            // Get all hold invoices for the order
            const holdInvoices = yield getHoldInvoicesByOrderId(orderId);
            const settlePromises = holdInvoices.map(paymentHash => settleHoldInvoice(paymentHash));
            // Settle all hold invoices
            const settledInvoices = yield Promise.all(settlePromises);
            return settledInvoices;
        }
        catch (error) {
            throw error;
        }
    });
}
function generateInvoice(amount_msat, description, label) {
    return __awaiter(this, void 0, void 0, function* () {
        const data = {
            amount_msat, // Make sure this is in millisatoshis and the value is correct
            label, // Unique identifier for the invoice
            description, // Description for the invoice
            cltv: 770 // Ensure this CLTV value is ACCEPTED by your Lightning service
        };
        // Log the request data for debugging purposes
        console.log('Sending data to generate invoice:', data);
        try {
            const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/invoice`, {
                method: 'POST',
                // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
                headers: {
                    'Accept': 'application/json',
                    'Rune': MY_RUNE,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
                agent: new https.Agent({ rejectUnauthorized: false }),
            });
            // Read and log the full response body for debugging
            const responseBody = yield response.text();
            console.log('Received response body:', responseBody);
            if (!response.ok) {
                // Log detailed error message before throwing
                console.error(`HTTP Error: ${response.status} with body: ${responseBody}`);
                throw new Error(`HTTP Error: ${response.status}`);
            }
            const invoiceData = JSON.parse(responseBody);
            if (!invoiceData.bolt11) {
                console.error('Response missing bolt11:', invoiceData);
                throw new Error('Bolt11 is missing in the response');
            }
            // Log the successful invoice data retrieval
            console.log('Received invoice data:', invoiceData);
            return invoiceData;
        }
        catch (error) {
            // Log and rethrow the error to be handled or logged further up the call stack
            console.error('Error in generating Bolt11 invoice:', error);
            throw error;
        }
    });
}
export const checkInvoiceStatus = (payment_hash) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const response = yield fetch(`${LIGHTNING_NODE_API_URL}/v1/listinvoices`, {
            method: 'POST',
            // @ts-expect-error TS(2322): Type '{ Accept: string; Rune: string | undefined; ... Remove this comment to see the full error message
            headers: {
                'Accept': 'application/json',
                'Rune': MY_RUNE,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ payment_hash }),
            agent: new https.Agent({ rejectUnauthorized: false }),
        });
        if (!response.ok) {
            const responseBody = yield response.text();
            console.error(`HTTP Error: ${response.status} with body: ${responseBody}`);
            throw new Error(`HTTP Error: ${response.status}`);
        }
        const data = yield response.json();
        if (data.invoices && data.invoices.length > 0) {
            return data.invoices[0];
        }
        else {
            throw new Error('Invoice not found');
        }
    }
    catch (error) {
        console.error('Error checking invoice status:', error);
        throw error;
    }
});
const checkInvoicePayment = (payment_hash) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const invoice = yield checkInvoiceStatus(payment_hash);
        return invoice.status === 'paid';
    }
    catch (error) {
        console.error('Error checking invoice payment:', error);
        throw error;
    }
});
export { postHoldinvoice, holdInvoiceLookup, generateBolt11Invoice, syncInvoicesWithNode, syncPayoutsWithNode, postFullAmountInvoice, handleFiatReceived, settleHoldInvoice, checkAndProcessPendingPayouts, updatePayoutStatus, settleHoldInvoiceByHash, payInvoice, settleHoldInvoicesByOrderIdService, checkInvoicesAndCreateChatroom, createChatroom, settleHoldInvoices, updateOrderStatus, getHoldInvoicesByOrderId, generateInvoice, checkInvoicePayment };
