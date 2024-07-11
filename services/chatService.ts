import fetch from 'node-fetch';
import https from 'https';
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
  // @ts-expect-error TS(2322): Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
  port: process.env.DB_PORT,
});

async function createChatroom(orderId: any) {
    const makeOfferUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
    return { makeOfferUrl };
}

async function saveAcceptOfferUrl(orderId: any, acceptOfferUrl: any) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE chats SET accept_offer_url = $1 WHERE order_id = $2',
        [acceptOfferUrl, orderId]
      );
      console.log(`Accept-offer URL saved for Order ID: ${orderId}`);
    } catch (error) {
      console.error('Error saving accept-offer URL:', error);
      throw error;
    } finally {
      client.release();
    }
}

async function updateAcceptOfferUrl(chat_id: any, accept_offer_url: any) {
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE chats SET accept_offer_url = $1 WHERE chat_id = $2',
        [accept_offer_url, chat_id]
      );
      console.log(`Accept-offer URL updated for Chat ID: ${chat_id}`);
    } catch (error) {
      console.error('Error updating accept-offer URL:', error);
      throw error;
    } finally {
      client.release();
    }
}

async function checkAndCreateChatroom(orderId: any) {
    const client = await pool.connect();
    try {
      // Check if a chatroom already exists for the given orderId
      const existingChatResult = await client.query('SELECT * FROM chats WHERE order_id = $1', [orderId]);
      
      if (existingChatResult.rows.length > 0) {
        const existingChat = existingChatResult.rows[0];
        console.log(`Chatroom already exists for Order ID: ${orderId}. Returning existing accept-offer URL: ${existingChat.accept_offer_url}`);
        return { makeOfferUrl: existingChat.chatroom_url, acceptOfferUrl: existingChat.accept_offer_url || '' };
      }

      // Check if the order exists and has status 'chat_open'
      const orderResult = await client.query('SELECT * FROM orders WHERE order_id = $1 AND status = $2', [orderId, 'chat_open']);
      
      if (orderResult.rows.length === 0) {
        console.log(`No orders with status 'chat_open' found for order ID: ${orderId}`);
        return null;
      }

      const order = orderResult.rows[0];
      const { makeOfferUrl } = await createChatroom(order.order_id);
  
      await client.query(
        'INSERT INTO chats (order_id, chatroom_url, accept_offer_url, status) VALUES ($1, $2, $3, $4)',
        [order.order_id, makeOfferUrl, '', 'open']
      );

      console.log(`Chatroom created for Order ID: ${order.order_id}. Make Offer URL: ${makeOfferUrl}`);
      return { makeOfferUrl, acceptOfferUrl: '' };
    } catch (error) {
      console.error('Error checking chat open status:', error);
      throw error;
    } finally {
      client.release();
    }
}

export { checkAndCreateChatroom, updateAcceptOfferUrl };
