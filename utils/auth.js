// utils/auth.js
import jwt from 'jsonwebtoken';
const SECRET_KEY = process.env.JWT_SECRET || 'Di1dSfqduLJuSxiqlVVnJbIeH6Bb+PRr3VoH0Vffziw=';

// Generate JWT Token
export const generateToken = (user) => {
  return jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
};

// Verify JWT Token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (error) {
    throw new Error('Invalid token');
  }
};
