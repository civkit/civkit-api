var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import bcrypt from 'bcrypt';
import fs from 'fs';
import { pool, prisma } from '../config/db.js';
import { generateInvoice, checkInvoicePayment } from './invoiceService.js';
import { exec } from 'child_process';
// Register User
export const registerUser = (username, password) => __awaiter(void 0, void 0, void 0, function* () {
    // Hash the password
    const hashedPassword = yield bcrypt.hash(password, 10);
    // Generate an invoice
    const amount_msat = 10; // Example: 1 satoshi as 1000 millisatoshis
    const description = "Registration Fee";
    const label = `Registration_${username}_${Date.now()}`;
    let invoiceData;
    try {
        invoiceData = yield generateInvoice(amount_msat, description, label);
    }
    catch (error) {
        console.error('Error generating invoice:', error);
        throw new Error('Failed to generate invoice');
    }
    const { bolt11: invoice, payment_hash } = invoiceData;
    // Insert user with username, invoice, hashed password, and payment_hash
    const query = 'INSERT INTO users (username, password, invoice, payment_hash, status) VALUES ($1, $2, $3, $4, $5) RETURNING *';
    const values = [username, hashedPassword, invoice, payment_hash, 'pending'];
    try {
        const { rows } = yield pool.query(query, values);
        return rows[0];
    }
    catch (error) {
        console.error('Error registering user:', error);
        throw new Error('User registration failed');
    }
});
// Finalize Registration after verifying payment
export const finalizeRegistration = (username) => __awaiter(void 0, void 0, void 0, function* () {
    // Check if the invoice is paid
    const user = yield getUserByUsername(username);
    if (!user) {
        throw new Error('User not found');
    }
    const isPaid = yield checkInvoicePayment(user.payment_hash); // Assuming payment_hash is used
    if (!isPaid) {
        throw new Error('Invoice payment not verified');
    }
    // Update user status to 'complete' after payment verification
    const updatedUser = yield updateUserStatus(username, 'complete');
    return updatedUser;
});
// Authenticate User
export const authenticateUser = (username, password) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma.user.findUnique({
            where: { username: username },
        });
        if (!user)
            throw new Error('User not found');
        const isPasswordValid = yield bcrypt.compare(password, user.password);
        if (!isPasswordValid)
            throw new Error('Invalid credentials');
        return user;
    }
    catch (error) {
        throw new Error('Authentication failed');
    }
});
// Update User Status and Add to Whitelist
export const updateUserStatus = (username, status) => __awaiter(void 0, void 0, void 0, function* () {
    const query = 'UPDATE users SET status = $1 WHERE username = $2 AND status != $1 RETURNING *';
    const values = [status, username];
    try {
        const { rows } = yield pool.query(query, values);
        if (rows.length === 0) {
            console.log(`User ${username} already has status ${status}, skipping update.`);
            return null; // No update was made
        }
        const updatedUser = rows[0];
        if (status === 'complete') {
            // Add the username (npub) to the pubkey_whitelist
            yield addPubkeyToWhitelist(username);
        }
        return updatedUser;
    }
    catch (error) {
        console.error('Error updating user status:', error);
        throw new Error('User status update failed');
    }
});
const stopContainer = (callback) => {
    exec('podman stop nostr-relay', (error, stdout, stderr) => {
        if (error && !stderr.includes('no such container')) {
            console.error(`Error stopping relay: ${error}`);
            return callback(error);
        }
        console.log(`Relay stopped successfully: ${stdout}`);
        callback(null);
    });
};
const removeContainer = (callback) => {
    exec('podman rm nostr-relay', (error, stdout, stderr) => {
        if (error && !stderr.includes('no such container')) {
            console.error(`Error removing relay: ${error}`);
            return callback(error);
        }
        console.log(`Relay removed successfully: ${stdout}`);
        callback(null);
    });
};
// alot of hardcodes here 
const runContainer = () => {
    exec('podman run -d --rm -p 7000:8080 --user=100:100 -v /home/dave/nostr-rs-relay/data:/usr/src/app/db:Z -v /home/dave/nostr-rs-relay/config.toml:/usr/src/app/config.toml:ro,Z --name nostr-relay nostr-rs-relay:latest', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting relay: ${error}`);
            return;
        }
        if (stderr) {
            console.error(`Stderr from relay start: ${stderr}`);
            return;
        }
        console.log(`Relay started successfully: ${stdout}`);
    });
};
const restartRelay = () => {
    stopContainer((stopError) => {
        if (!stopError || stopError.message.includes('no such container')) {
            removeContainer((removeError) => {
                if (!removeError || removeError.message.includes('no such container')) {
                    runContainer();
                }
            });
        }
    });
};
const addPubkeyToWhitelist = (pubkey) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const configPath = '/home/dave/nostr-rs-relay/config.toml';
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const whitelistRegex = /pubkey_whitelist\s*=\s*\[(.*?)\]/s;
        const match = configContent.match(whitelistRegex);
        if (match) {
            let whitelist = match[1].trim();
            const pubkeyArray = whitelist.split(',').map(key => key.trim().replace(/"/g, ''));
            if (!pubkeyArray.includes(pubkey)) {
                const updatedWhitelist = `${whitelist}, "${pubkey}"`;
                const updatedConfig = configContent.replace(whitelistRegex, `pubkey_whitelist = [${updatedWhitelist}]`);
                fs.writeFileSync(configPath, updatedConfig, 'utf-8');
                console.log(`Added ${pubkey} to pubkey_whitelist in config.toml`);
                // Restart the relay service
                restartRelay();
            }
            else {
                console.log(`${pubkey} is already in the pubkey_whitelist.`);
            }
        }
        else {
            console.error('pubkey_whitelist not found in config.toml');
        }
    }
    catch (error) {
        console.error('Error adding pubkey to whitelist:', error);
        throw new Error('Failed to update whitelist');
    }
});
// Poll and Complete Registration
export const pollAndCompleteRegistration = () => __awaiter(void 0, void 0, void 0, function* () {
    const query = 'SELECT username, payment_hash FROM users WHERE status = $1';
    const values = ['pending'];
    try {
        const { rows } = yield pool.query(query, values);
        for (const user of rows) {
            try {
                const invoiceStatus = yield checkInvoicePayment(user.payment_hash);
                // If invoice is paid, update user status to 'complete'
                if (invoiceStatus) {
                    yield updateUserStatus(user.username, 'complete');
                    console.log(`User ${user.username} registration completed.`);
                }
            }
            catch (error) {
                console.error(`Error checking invoice for user ${user.username}:`, error);
            }
        }
    }
    catch (error) {
        console.error('Error fetching users with pending registration:', error);
        throw new Error('Failed to poll and complete registrations');
    }
});
// Helper function to get user by username
const getUserByUsername = (username) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield prisma.user.findUnique({
            where: {
                username: username
            }
        });
        if (!user) {
            return null; // Or you might want to throw an error here, depending on your use case
        }
        return user;
    }
    catch (error) {
        console.error('Error fetching user by username:', error);
        throw new Error('Failed to fetch user');
    }
});
