import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';

export class NotificationServer {
  private io: Server;
  private userSockets: Map<number, string[]> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('register', (userId: number) => {
        this.userSockets.set(userId, socket.id);
      });

      socket.on('disconnect', () => {
        for (const [userId, socketId] of this.userSockets.entries()) {
          if (socketId === socket.id) this.userSockets.delete(userId);
        }
      });
    });
  }

  async notifyTaker(orderId: number, takerId: number) {
    const socketId = this.userSockets.get(takerId);
    if (socketId) {
      this.io.to(socketId).emit('chatReady', {
        orderId,
        message: 'Chat room is ready to join'
      });
    }
  }

  public async notifyAcceptOfferReady(orderId: number) {
    try {
      // Get the order to find both maker and taker
      const order = await prisma.order.findUnique({
        where: { order_id: orderId },
        include: {
          chats: true
        }
      });

      if (!order || !order.chats[0]?.accept_offer_url) {
        console.error('No accept offer URL found for order:', orderId);
        return;
      }

      // Notify both maker and taker
      const userIds = [order.customer_id, order.taker_customer_id].filter(Boolean);
      
      userIds.forEach(userId => {
        if (userId) {
          this.sendNotification(userId, {
            type: 'ACCEPT_OFFER_READY',
            orderId: order.order_id,
            acceptOfferUrl: order.chats[0].accept_offer_url,
            message: 'Accept offer URL is now available'
          });
        }
      });
    } catch (error) {
      console.error('Error sending accept offer notification:', error);
    }
  }
}