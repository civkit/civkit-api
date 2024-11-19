import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';

export class NotificationServer {
  private io: Server;
  private userSockets: Map<number, string> = new Map();

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
}