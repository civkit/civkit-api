var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { config } from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
config(); // Load environment variables
const CHAT_APP_URL = 'http://localhost:3456';
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
function createChatroom(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const makeOfferUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
        return { makeOfferUrl };
    });
}
function saveAcceptOfferUrl(orderId, acceptOfferUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            yield client.query('UPDATE chats SET accept_offer_url = $1 WHERE order_id = $2', [acceptOfferUrl, orderId]);
            console.log(`Accept-offer URL saved for Order ID: ${orderId}`);
        }
        catch (error) {
            console.error('Error saving accept-offer URL:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function updateAcceptOfferUrl(chat_id, accept_offer_url) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            yield client.query('UPDATE chats SET accept_offer_url = $1 WHERE chat_id = $2', [accept_offer_url, chat_id]);
            console.log(`Accept-offer URL updated for Chat ID: ${chat_id}`);
        }
        catch (error) {
            console.error('Error updating accept-offer URL:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
function checkAndCreateChatroom(orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield pool.connect();
        try {
            // Check if a chatroom already exists for the given orderId
            const existingChatResult = yield client.query('SELECT * FROM chats WHERE order_id = $1', [orderId]);
            if (existingChatResult.rows.length > 0) {
                const existingChat = existingChatResult.rows[0];
                console.log(`Chatroom already exists for Order ID: ${orderId}. Returning existing accept-offer URL: ${existingChat.accept_offer_url}`);
                return { makeOfferUrl: existingChat.chatroom_url, acceptOfferUrl: existingChat.accept_offer_url || '' };
            }
            // Check if the order exists and has status 'chat_open'
            const orderResult = yield client.query('SELECT * FROM orders WHERE order_id = $1 AND status = $2', [orderId, 'chat_open']);
            if (orderResult.rows.length === 0) {
                console.log(`No orders with status 'chat_open' found for order ID: ${orderId}`);
                return null;
            }
            const order = orderResult.rows[0];
            const { makeOfferUrl } = yield createChatroom(order.order_id);
            yield client.query('INSERT INTO chats (order_id, chatroom_url, accept_offer_url, status) VALUES ($1, $2, $3, $4)', [order.order_id, makeOfferUrl, '', 'open']);
            console.log(`Chatroom created for Order ID: ${order.order_id}. Make Offer URL: ${makeOfferUrl}`);
            return { makeOfferUrl, acceptOfferUrl: '' };
        }
        catch (error) {
            console.error('Error checking chat open status:', error);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
export { checkAndCreateChatroom, updateAcceptOfferUrl };
