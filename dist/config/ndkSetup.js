var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import readline from 'readline';
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
let our_relays = ["ws://localhost:8080"];
await (() => __awaiter(void 0, void 0, void 0, function* () {
    const question = (query) => new Promise((resolve) => {
        rl.question(query, resolve);
    });
    // const answer = await question('Enter relay URLs (separated by commas (if empty ws://localhost:8080 will be used)):');
    // let relayUrls = answer.trim().split(',');
    // our_relays = relayUrls.length === 1 && relayUrls[0] === "" ? our_relays : relayUrls;
    console.log('Relay URLs:', our_relays);
    rl.close();
}))();
const privateKeyFilePath = './.NDK_private_key';
function initializeSignerSync() {
    let privateKey;
    if (existsSync(privateKeyFilePath)) {
        privateKey = readFileSync(privateKeyFilePath, 'utf8');
        console.log('Private key loaded from file.');
    }
    else {
        const generated = NDKPrivateKeySigner.generate();
        privateKey = generated.privateKey;
        // @ts-expect-error TS(2345): Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
        writeFileSync(privateKeyFilePath, privateKey);
        console.log('New private key generated and saved.');
    }
    const signer = new NDKPrivateKeySigner(privateKey);
    return signer;
}
export function initializeNDK() {
    return __awaiter(this, void 0, void 0, function* () {
        const ndk = new NDK({
            explicitRelayUrls: our_relays,
            signer: initializeSignerSync()
        });
        yield ndk.connect();
        // @ts-expect-error TS(2532): Object is possibly 'undefined'.
        const user = yield ndk.signer.user();
        console.log('\x1b[36m' + 'Our Pubkey: ' + user.pubkey + '\x1b[0m');
    });
}
