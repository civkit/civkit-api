import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let our_relays = ["ws://localhost:8080"];
await (async () => {
  const question = (query: any) => new Promise((resolve) => {
    rl.question(query, resolve);
  });
  // const answer = await question('Enter relay URLs (separated by commas (if empty ws://localhost:8080 will be used)):');
  // let relayUrls = answer.trim().split(',');

  // our_relays = relayUrls.length === 1 && relayUrls[0] === "" ? our_relays : relayUrls;
  console.log('Relay URLs:', our_relays);
  rl.close();
})();

const privateKeyFilePath = './.NDK_private_key';

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
}