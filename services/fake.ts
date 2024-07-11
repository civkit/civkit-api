import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/db.js';
import { generateInvoice, checkInvoicePayment } from './invoiceService.js';
import { exec } from 'child_process';

// Register User
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

  // Insert user with username, invoice, hashed password, and payment_hash
  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        invoice,
        payment_hash,
        status: 'pending'
      },
    });
    return user;
  } catch (error) {
    console.error('Error registering user:', error);
    throw new Error('User registration failed');
  }
};

// Finalize Registration after verifying payment
export const finalizeRegistration = async (username: string) => {
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
export const authenticateUser = async (username: string, password: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: username },
    });

    if (!user) throw new Error('User not found');

    const isPasswordValid = await bcrypt.compare(password, user.password);
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
        username: username,
        NOT: {
          status: status
        }
      },
      data: { status: status }
    });

    if (updatedUser.count === 0) {
      console.log(`User ${username} already has status ${status}, skipping update.`);
      return null; // No update was made
    }

    if (status === 'complete') {
      // Add the username (npub) to the pubkey_whitelist
      await addPubkeyToWhitelist(username);
    }

    return await prisma.user.findUnique({
      where: { username: username }
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    throw new Error('User status update failed');
  }
};

// ... (stopContainer, removeContainer, runContainer, restartRelay functions remain unchanged)

// Poll and Complete Registration
export const pollAndCompleteRegistration = async () => {
  try {
    const pendingUsers = await prisma.user.findMany({
      where: { status: 'pending' },
      select: { username: true, payment_hash: true }
    });

    for (const user of pendingUsers) {
      try {
        const invoiceStatus = await checkInvoicePayment(user.payment_hash);

        // If invoice is paid, update user status to 'complete'
        if (invoiceStatus) {
          await updateUserStatus(user.username, 'complete');
          console.log(`User ${user.username} registration completed.`);
        }
      } catch (error) {
        console.error(`Error checking invoice for user ${user.username}:`, error);
      }
    }
  } catch (error) {
    console.error('Error fetching users with pending registration:', error);
    throw new Error('Failed to poll and complete registrations');
  }
};

// Helper function to get user by username
const getUserByUsername = async (username: string) => {
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