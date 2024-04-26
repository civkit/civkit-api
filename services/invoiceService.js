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

    return await response.json();
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

// Export statements for ES Modules
export { postHoldinvoice, holdInvoiceLookup };
