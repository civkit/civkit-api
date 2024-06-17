// services/userService.js
import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { generateInvoice, checkInvoicePayment } from './invoiceService.js';  // Assuming these functions are in invoiceService.js

// Modified Register User to handle npub and invoice creation
// Adjust the registerUser function to handle npub and invoice generation
// Register User
export const registerUser = async (username, password) => {
  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Generate an invoice
  const amount_msat = 1000; // Example: 1 satoshi as 1000 millisatoshis
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
  const query = 'INSERT INTO users (username, password, invoice, payment_hash, status) VALUES ($1, $2, $3, $4, $5) RETURNING *';
  const values = [username, hashedPassword, invoice, payment_hash, 'pending'];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    console.error('Error registering user:', error);
    throw new Error('User registration failed');
  }
};


// Finalize Registration after verifying payment
export const finalizeRegistration = async (npub) => {
  // Check if the invoice is paid
  const isPaid = await checkInvoicePayment(npub);  // Implement this function based on how you track paid invoices

  if (!isPaid) {
    throw new Error('Invoice payment not verified');
  }

  // Update user status to 'active' after payment verification
  const query = 'UPDATE users SET status = $1 WHERE npub = $2 RETURNING *';
  const values = ['active', npub];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    throw new Error('Failed to finalize registration: ' + error.message);
  }
};

// Authenticate User
export const authenticateUser = async (username, password) => {
  const query = 'SELECT * FROM users WHERE username = $1';
  const values = [username];

  try {
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) throw new Error('User not found');

    const user = rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new Error('Invalid credentials');

    return user;
  } catch (error) {
    throw new Error('Authentication failed');
  }
};


export const updateUserStatus = async (username, status) => {
  const query = 'UPDATE users SET status = $1 WHERE username = $2 RETURNING *';
  const values = [status, username];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    console.error('Error updating user status:', error);
    throw new Error('User status update failed');
  }
};

import { checkInvoiceStatus } from './invoiceService.js';

export const pollAndCompleteRegistration = async () => {
  // Fetch all users with pending registration (assume status is 'pending')
  const query = 'SELECT username, payment_hash FROM users WHERE status = $1';
  const values = ['pending'];

  try {
    const { rows } = await pool.query(query, values);

    for (const user of rows) {
      try {
        const isPaid = await checkInvoiceStatus(user.payment_hash);

        // If invoice is paid, update user status to 'complete'
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
    throw new Error('Failed to poll and complete registrations');
  }
};

// Assume existing authenticateUser function remains for password-based users
// If migrating fully to npub-based auth, this function would need to be adapted or removed.
