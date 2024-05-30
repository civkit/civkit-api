// utils/auth.js
import jwt from 'jsonwebtoken';
const SECRET_KEY = process.env.JWT_SECRET || 'Di1dSfqduLJuSxiqlVVnJbIeH6Bb+PRr3VoH0Vffziw=';

// Generate JWT Token
export const generateToken = (user) => {
  return jwt.sign({ id: user.id, username: user.username, customer_id: user.customer_id }, SECRET_KEY, { expiresIn: '24h' });
};

// Verify JWT Token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (error) {
    throw new Error('Invalid token');
  }
};
