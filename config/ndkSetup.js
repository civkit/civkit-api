import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const privateKeyFilePath = process.env.PRIVATE_KEY_FILE_PATH || './.NDK_private_key';
let our_relays = process.env.RELAY_URLS ? process.env.RELAY_URLS.split(',') : ["ws://localhost:8080"];

console.log('Relay URLs:', our_relays);

function initializeSignerSync() {
  let privateKey;
  if (existsSync(privateKeyFilePath)) {
    privateKey = readFileSync(privateKeyFilePath, 'utf8');
    console.log('Private key loaded from file.');
  } else {
    const generated = NDKPrivateKeySigner.generate();
    privateKey = generated.privateKey;
    writeFileSync(privateKeyFilePath, privateKey);
    console.log('New private key generated and saved.');
  }

  const signer = new NDKPrivateKeySigner(privateKey);
  return signer;
}

export async function initializeNDK() {
  const ndk = new NDK({
    explicitRelayUrls: our_relays,
    signer: initializeSignerSync()
  });
  await ndk.connect();

  const user = await ndk.signer.user();
  console.log('\x1b[36m' + 'Our Pubkey: ' + user.pubkey + '\x1b[0m');

  // Set the escrow runner's npub in the environment variables
  process.env.ESCROW_NPUB = user.pubkey;
}

// Initialize NDK
initializeNDK().catch(console.error);
