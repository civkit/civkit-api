import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const filterOrdersByVisibility = async (req: any, res: any, next: any) => {
  try {
    // For authenticated users, show pending orders + their own orders
    const whereClause = req.user ? {
      OR: [
        { status: 'pending' },
        {
          AND: [
            { status: { not: 'pending' } },
            {
              OR: [
                { customer_id: req.user.id },
                { taker_customer_id: req.user.id }
              ]
            }
          ]
        }
      ]
    } : {
      // For non-authenticated users, only show pending orders
      status: 'pending'
    };

    // Let Prisma handle the filtering
    const orders = await prisma.order.findMany({
      where: whereClause
    });

    req.filteredOrders = orders;
    next();
  } catch (error) {
    console.error('Error filtering orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
