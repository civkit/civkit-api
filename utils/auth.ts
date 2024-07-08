import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET_KEY = process.env.JWT_SECRET as string;

// Generate JWT Token
export const generateToken = (user: any) => {
  return jwt.sign(
    { id: user.id, username: user.username, customer_id: user.customer_id },
    SECRET_KEY,
    { expiresIn: '90d' }
  );
};

// Verify JWT Token
export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (error) {
    throw new Error('Invalid token');
  }
};
