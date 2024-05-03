// Import statements for ES Modules
import fetch from 'node-fetch';
import https from 'https';
import express from 'express';
import { config } from 'dotenv';
config(); // This line configures dotenv to load the environment variables

const LIGHTNING_NODE_API_URL = process.env.LIGHTNING_NODE_API_URL;
const MY_RUNE = process.env.RUNE;

async function postHoldinvoice(amount_msat, label, description) {
  const data = {
    amount_msat,
    label,
    description,
    cltv: 770,
  };
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
      method: 'POST',
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

    return await response.json();async function generateBolt11Invoice(amount_msat, label, description) {
      const data = {
          amount_msat,
          label,
          description,
      };
      try {
          const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
              method: 'POST',
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
    
          const invoiceData = await response.json();
          if (!invoiceData.bolt11) {
              console.error('Response missing bolt11:', invoiceData);
              throw new Error('bolt11 is missing in the response');
          }
          return invoiceData;
      } catch (error) {
          console.error('Error in generating Bolt11 invoice:', error);
          throw error;
      }
    }
  } catch (error) {
    console.error('Failed to post invoice:', error);
    throw error;
  }
}

async function holdInvoiceLookup(payment_hash) {
  try {
    const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoicelookup`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Rune': MY_RUNE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payment_hash }),
      agent: new https.Agent({ rejectUnauthorized: false }),
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to lookup invoice:', error);
    throw error;
  }
}

async function generateBolt11Invoice(amount_msat, label, description) {
  const data = {
      amount_msat:  parseInt(amount_msat),
      label,
      description,
      cltv: 770,

  };
  try {
      const response = await fetch(`${LIGHTNING_NODE_API_URL}/v1/holdinvoice`, {
          method: 'POST',
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

      const invoiceData = await response.json();
      if (!invoiceData.bolt11) {
          console.error('Response missing bolt11:', invoiceData);
          throw new Error('bolt11 is missing in the response');
      }
      return invoiceData;
  } catch (error) {
      console.error('Error in generating Bolt11 invoice:', error);
      throw error;
  }
}


// Monitoring and updating the status
async function checkAndUpdateOrderStatus(orderId, payment_hash) {
  const client = await pool.connect();
  try {
    client.query('BEGIN');

    const checkInvoiceStatus = await queryInvoiceStatus(payment_hash); // Assume this function checks the payment status
    if (checkInvoiceStatus === 'paid') {
      const updateOrderText = `
        UPDATE orders
        SET status = 'bonds_locked'
        WHERE order_id = $1
        RETURNING *;
      `;
      const result = await client.query(updateOrderText, [orderId]);
      client.query('COMMIT');
      return result.rows[0];
    }
    client.query('ROLLBACK');
  } catch (error) {
    client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export {
  postHoldinvoice,
  holdInvoiceLookup,
  generateBolt11Invoice,
  checkAndUpdateOrderStatus,
};
