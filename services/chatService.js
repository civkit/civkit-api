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
  port: process.env.DB_PORT,
});

async function createChatroom(orderId) {
    const makeOfferUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
    const acceptOfferUrl = `${CHAT_APP_URL}/ui/chat/accept-offer?orderId=${orderId}`;
    return { makeOfferUrl, acceptOfferUrl };
  }

  async function saveAcceptOfferUrl(orderId, acceptOfferUrl) {
    const client = await pool.connect();
    try {
      // Update the chats table with the accept-offer URL
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
  

async function checkAndCreateChatroom(orderId) {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM orders WHERE order_id = $1 AND status = $2', [orderId, 'chat_open']);
      
      if (result.rows.length === 0) {
        console.log(`No orders with status 'chat_open' found for order ID: ${orderId}`);
        return null;
      }
  
      const order = result.rows[0];
      const { makeOfferUrl, acceptOfferUrl } = await createChatroom(order.order_id);
  
      // Save both URLs to the chat table
      await client.query(
        'INSERT INTO chats (order_id, chatroom_url, accept_offer_url, status) VALUES ($1, $2, $3, $4)',
        [order.order_id, makeOfferUrl, acceptOfferUrl, 'open']
      );
  
      console.log(`Chatroom created for Order ID: ${order.order_id}. Make Offer URL: ${makeOfferUrl}, Accept Offer URL: ${acceptOfferUrl}`);
      return { makeOfferUrl, acceptOfferUrl };
    } catch (error) {
      console.error('Error checking chat open status:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
export { checkAndCreateChatroom };
