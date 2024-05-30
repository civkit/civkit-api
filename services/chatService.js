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
  return `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
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
    const chatroomUrl = await createChatroom(order.order_id);

    // Save the chat URL to the chat table
    await client.query(
      'INSERT INTO chats (order_id, chatroom_url, status) VALUES ($1, $2, $3)',
      [order.order_id, chatroomUrl, 'open']
    );

    console.log(`Chatroom created for Order ID: ${order.order_id}. URL: ${chatroomUrl}`);
    return chatroomUrl;
  } catch (error) {
    console.error('Error checking chat open status:', error);
    throw error;
  } finally {
    client.release();
  }
}

export { checkAndCreateChatroom };
