import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as fs from "fs";
import { generateInvoice, checkInvoicePayment } from './invoiceService.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { nip19 } from 'nostr-tools';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const execAsync = promisify(exec);

const nostrRelayConfigPath = process.env.NOSTR_RELAY_CONFIG_PATH;

export const registerUser = async (username: string, password: string) => {
  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate an invoice
  const amount_msat = 10; // Example: 1 satoshi as 1000 millisatoshis
  const description = "Registration Fee";
  const label = `Registration_${username}_${Date.now()}`;

  let invoiceData;
  try {
    invoiceData = await generateInvoice(amount_msat, description, label);
  } catch (error) {
    console.error('Error generating invoice:', error);
    throw new Error('Failed to generate invoice');
  }

  const { bolt11: invoice, payment_hash } = invoiceData;

  // Insert user with Prisma
  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        invoice,
        payment_hash,
        status: 'pending',
      }
    });
    return user;
  } catch (error) {
    console.error('Error registering user:', error);
    throw new Error('User registration failed');
  }
};

// Finalize Registration after verifying payment
export const finalizeRegistration = async (username: any) => {
  // Check if the invoice is paid
  const user = await getUserByUsername(username);
  if (!user) {
    throw new Error('User not found');
  }

  const isPaid = await checkInvoicePayment(user.payment_hash); // Assuming payment_hash is used

  if (!isPaid) {
    throw new Error('Invoice payment not verified');
  }

  // Update user status to 'complete' after payment verification
  const updatedUser = await updateUserStatus(username, 'complete');
  return updatedUser;
};

// Authenticate User

export const authenticateUser = async (username: string, password:string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: username },
    });

    if (!user) throw new Error('User not found');

    console.log(`Comparing password: ${password} with stored hash.`);


    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`Password valid: ${isPasswordValid}`);
    if (!isPasswordValid) throw new Error('Invalid credentials');

    return user;
  } catch (error) {
    throw new Error('Authentication failed');
  }
};

// Update User Status and Add to Whitelist
export const updateUserStatus = async (username: string, status: string) => {
  try {
    const updatedUser = await prisma.user.updateMany({
      where: { 
        username,
        NOT: { status }
      },
      data: { status }
    });

    if (updatedUser.count === 0) {
      console.log(`User ${username} already has status ${status}, skipping update.`);
      return null;
    }

    if (status === 'complete') {
      await addPubkeyToWhitelist(username);
    }

    return updatedUser;
  } catch (error) {
    console.error('Error updating user status:', error);
    throw new Error('User status update failed');
  }
};

export const stopContainer = async () => {
  try {
    const { stdout, stderr } = await execAsync('podman stop nostr-relay');
    if (stderr && !stderr.includes('no such container')) {
      console.error(`Error stopping relay: ${stderr}`);
      throw new Error(stderr);
    }
    console.log(`Relay stopped successfully: ${stdout}`);
  } catch (error) {
    if (error.message.includes('no such container')) {
      console.log('No container to stop');
    } else {
      throw error;
    }
  }
};

export const removeContainer = async () => {
  try {
    const { stdout, stderr } = await execAsync('podman rm nostr-relay');
    if (stderr && !stderr.includes('no such container')) {
      console.error(`Error removing relay: ${stderr}`);
      throw new Error(stderr);
    }
    console.log(`Relay removed successfully: ${stdout}`);
  } catch (error) {
    if (error.message.includes('no such container')) {
      console.log('No container to remove');
    } else {
      throw error;
    }
  }
};

const restartRelay = async () => {
  try {
    await stopContainer();
    await removeContainer();
    await runContainer();
  } catch (error) {
    console.error('Error restarting relay:', error);
    throw error;
  }
};

export const runContainer = async () => {
  try {
    const { stdout, stderr } = await execAsync('podman run -d --rm -p 7000:8080 --user=100:100 -v /home/dave/nostr-rs-relay/data:/usr/src/app/db:Z -v /home/dave/nostr-rs-relay/config.toml:/usr/src/app/config.toml:ro,Z --name nostr-relay nostr-rs-relay:latest');
    if (stderr) {
      console.error(`Stderr from relay start: ${stderr}`);
      throw new Error(stderr);
    }
    console.log(`Relay started successfully: ${stdout}`);
  } catch (error) {
    console.error(`Error starting relay: ${error}`);
    throw error;
  }
};

export const addPubkeyToWhitelist = async (pubkey: string) => {
  if (!nostrRelayConfigPath) {
    throw new Error('NOSTR_RELAY_CONFIG_PATH is not defined in the environment');
  }

  try {
    const hexPubkey = pubkey.startsWith('npub') ? nip19.decode(pubkey).data as string : pubkey;
    const configContent = await fs.promises.readFile(nostrRelayConfigPath, 'utf-8');
    const whitelistRegex = /pubkey_whitelist\s*=\s*\[(.*?)\]/s;
    const match = configContent.match(whitelistRegex);

    if (match) {
      let whitelist = match[1].trim();
      const pubkeyArray = whitelist.split(',').map(key => key.trim().replace(/"/g, ''));
      if (!pubkeyArray.includes(hexPubkey)) {
        const updatedWhitelist = `${whitelist}, "${hexPubkey}"`;
        const updatedConfig = configContent.replace(whitelistRegex, `pubkey_whitelist = [${updatedWhitelist}]`);
        await fs.promises.writeFile(nostrRelayConfigPath, updatedConfig, 'utf-8');
        console.log(`Added ${hexPubkey} to pubkey_whitelist in config.toml`);
        await restartRelay();
      } else {
        console.log(`${hexPubkey} is already in the pubkey_whitelist.`);
      }
    } else {
      throw new Error('pubkey_whitelist not found in config.toml');
    }
  } catch (error) {
    console.error('Error adding pubkey to whitelist:', error);
    throw new Error('Failed to update whitelist');
  }
};
// Poll and Complete Registration
export const pollAndCompleteRegistration = async () => {
  try {
    const pendingUsers = await prisma.user.findMany({
      where: { status: 'pending' },
      select: { id: true, username: true, payment_hash: true, created_at: true }
    });

    console.log(`Checking ${pendingUsers.length} pending users`);

    for (const user of pendingUsers) {
      try {
        console.log(`Checking invoice for user: ${user.username}`);
        
        // Check if the invoice is older than 24 hours
        const invoiceAge = Date.now() - user.created_at.getTime();
        const isExpired = invoiceAge > 24 * 60 * 60 * 1000; // 24 hours in milliseconds

        if (isExpired) {
          console.log(`Invoice for user ${user.username} is expired. Marking as failed.`);
          await updateUserStatus(user.username, 'failed');
          continue;
        }

        const isPaid = await checkInvoicePayment(user.payment_hash);
        console.log(`Invoice status for ${user.username}: ${isPaid}`);

        if (isPaid) {
          await updateUserStatus(user.username, 'complete');
          console.log(`User ${user.username} registration completed.`);
        }
      } catch (error) {
        console.error(`Error checking invoice for user ${user.username}:`, error);
      }
    }
  } catch (error) {
    console.error('Error fetching users with pending registration:', error);
  }
};

// Helper function to get user by username
export const getUserByUsername = async (username: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        username: username
      }
    });

    if (!user) {
      return null; // Or you might want to throw an error here, depending on your use case
    }

    return user;
  } catch (error) {
    console.error('Error fetching user by username:', error);
    throw new Error('Failed to fetch user');
  }
};
