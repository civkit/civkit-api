import WebSocket from 'ws';
import { getPublicKey, getEventHash, finalizeEvent } from 'nostr-tools/pure';

const relays = ['wss://civkit.africa', 'wss://relay.damus.io'];

function createEvent(privateKey: string, content: string) {
  const pubkey = getPublicKey(privateKey);
  const eventTemplate = {
    kind: 1505,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'civkit'], ['t', 'orderbook']],
    content,
    pubkey
  };

  return finalizeEvent(eventTemplate, privateKey);
}

export async function announceCivKitNode() {
  const privateKey = process.env.NOSTR_PRIVATE_KEY;
  if (!privateKey) {
    console.error('NOSTR_PRIVATE_KEY not set in environment variables');
    return;
  }

  const pubkey = getPublicKey(privateKey);
  console.log('Using pubkey:', pubkey);

  const content = JSON.stringify({
    message: "I'm a CivKit node. Place your orders here.",
    url: process.env.CIVKIT_ORDER_URL
  });

  const event = createEvent(privateKey, content);
  console.log('Created event:', JSON.stringify(event, null, 2));

  for (const relay of relays) {
    console.log(`\nAttempting to connect to ${relay}`);
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(relay);

        ws.on('open', () => {
          console.log(`Connected to ${relay}`);
          const message = JSON.stringify(["EVENT", event]);
          console.log(`Sending message to ${relay}:`, message);
          ws.send(message);
        });

        ws.on('message', (data) => {
          console.log(`Received message from ${relay}:`, data.toString());
          const message = JSON.parse(data.toString());
          if (message[0] === 'OK' && message[1] === event.id) {
            console.log(`Event published successfully to ${relay}`);
            ws.close();
            resolve(true);
          } else {
            console.log(`Unexpected response from ${relay}:`, message);
          }
        });

        ws.on('error', (error) => {
          console.error(`WebSocket error with ${relay}:`, error);
          reject(error);
        });

        ws.on('close', (code, reason) => {
          console.log(`Disconnected from ${relay}. Code: ${code}, Reason: ${reason}`);
        });

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log(`No response from ${relay} after 30 seconds, closing connection`);
            ws.close();
            reject(new Error('Timeout waiting for relay response'));
          }
        }, 30000);
      });

      console.log(`Successfully published to ${relay}`);
      break; // Exit the loop if successful
    } catch (error) {
      console.error(`Failed to publish to ${relay}:`, error);
    }
  }
}