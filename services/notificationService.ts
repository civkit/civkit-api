import { Server } from 'socket.io';

export class NotificationServer {
  private io: Server;
  private userSockets: Map<number, string[]> = new Map();

  constructor(io: Server) {
    this.io = io;

    this.io.on('connection', (socket) => {
      console.log('Client connected');
      
      // Client sends their user ID when connecting
      socket.on('register', (userId: number) => {
        const userSockets = this.userSockets.get(userId) || [];
        userSockets.push(socket.id);
        this.userSockets.set(userId, userSockets);
        console.log(`User ${userId} registered with socket ${socket.id}`);
      });

      socket.on('disconnect', () => {
        // Clean up disconnected sockets
        this.userSockets.forEach((sockets, userId) => {
          const remaining = sockets.filter(id => id !== socket.id);
          if (remaining.length) {
            this.userSockets.set(userId, remaining);
          } else {
            this.userSockets.delete(userId);
          }
        });
      });
    });
  }

  // Method to send notification to a specific user
  async notifyUser(userId: number, message: any) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        this.io.to(socketId).emit('notification', message);
      });
    }
  }

  // Your existing method
  async notifyTaker(orderId: number, takerId: number) {
    await this.notifyUser(takerId, {
      type: 'make-offer',
      orderId: orderId,
      message: 'New offer available'
    });
  }
}