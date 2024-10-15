import { verifyToken } from '../utils/auth.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const authenticateJWT = (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (authHeader) {
    const token = authHeader.split(' ')[1];

    try {
      const user = verifyToken(token);
      req.user = user; // This now includes id, username, customer_id, and roles
      next();
    } catch (error) {
      return res.sendStatus(403);
    }
  } else {
    res.sendStatus(401);
  }
};

export const authorizeRole = (allowedRoles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (req.user && req.user.roles) {
      const hasAllowedRole = req.user.roles.some((role: string) => allowedRoles.includes(role));
      if (hasAllowedRole) {
        next();
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(401);
    }
  };
};

export const authorizePayoutSubmission = async (req: any, res: any, next: any) => {
  if (!req.user) {
    return res.sendStatus(401);
  }

  const orderId = req.body.order_id; // Assuming order_id is sent in the request body
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const isAuthorized = 
      (order.type === 0 && order.customer_id === req.user.id) || // Buy order
      (order.type === 1 && order.taker_customer_id === req.user.id); // Sell order

    if (isAuthorized) {
      // Add order to the request object for use in the controller
      req.order = order;
      next();
    } else {
      res.sendStatus(403);
    }
  } catch (error) {
    console.error('Error in authorizePayoutSubmission:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const identifyUserRoleInOrder = async (req: any, res: any, next: any) => {
  if (!req.user) {
    return res.sendStatus(401);
  }

  const orderId = req.params.orderId; // Assuming order_id is in the URL parameters
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const order = await prisma.order.findUnique({
      where: { order_id: parseInt(orderId) },
      include: { chats: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if the user is the taker (taker_customer_id matches user's id)
    if (order.taker_customer_id === req.user.id) {
      req.userRole = 'taker';
      
      // Find the associated chat for this order
      const chat = order.chats.find(chat => chat.order_id === order.order_id);
      
      // If there's a chat with an accept_offer_url, add it to the request
      if (chat && chat.accept_offer_url) {
        req.acceptOfferUrl = chat.accept_offer_url;
      }
    } else {
      req.userRole = 'other'; // Could be maker or unrelated user
    }

    // Add order to the request object for use in the controller
    req.order = order;
    next();
  } catch (error) {
    console.error('Error in identifyUserRoleInOrder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
