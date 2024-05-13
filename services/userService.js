// services/userService.js
import bcrypt from 'bcrypt';
import { pool } from '../config/db.js'; // Ensure you have a db config file for PostgreSQL connection

// Register User
export const registerUser = async (username, password) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const query = 'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *';
  const values = [username, hashedPassword];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    throw new Error('User registration failed');
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
