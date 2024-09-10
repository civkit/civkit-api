import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CHAT_APP_URL = process.env.CHAT_APP_URL;

export async function checkAndCreateChatroom(orderId: number) {
  console.log(`[checkAndCreateChatroom] Starting process for Order ID: ${orderId}`);
  try {
    // Check if a chatroom already exists for this order
    const existingChat = await prisma.chat.findFirst({
      where: { order_id: orderId }
    });

    if (existingChat) {
      console.log(`[checkAndCreateChatroom] Existing chat found for Order ID: ${orderId}`);
      return {
        chatroomUrl: existingChat.chatroom_url,
        acceptOfferUrl: existingChat.accept_offer_url
      };
    }

    // Check if all invoices are paid
    const allInvoices = await prisma.invoice.findMany({
      where: { order_id: orderId }
    });

    console.log(`[checkAndCreateChatroom] Found ${allInvoices.length} invoices for Order ID: ${orderId}`);

    const allInvoicesPaid = allInvoices.length === 3 && 
                            allInvoices.every(invoice => invoice.status === 'paid');

    console.log(`[checkAndCreateChatroom] All invoices paid for Order ID ${orderId}: ${allInvoicesPaid}`);

    if (!allInvoicesPaid) {
      console.log(`[checkAndCreateChatroom] Not all invoices are paid for Order ID: ${orderId}. No chatroom created.`);
      return null;
    }

    // Create chatroom URLs
    const chatroomUrl = `${CHAT_APP_URL}/ui/chat/make-offer?orderId=${orderId}`;
    const acceptOfferUrl = `${CHAT_APP_URL}/ui/chat/accept-offer?orderId=${orderId}`;

    // Create chat in database
    const newChat = await prisma.chat.create({
      data: {
        order_id: orderId,
        chatroom_url: chatroomUrl,
        accept_offer_url: acceptOfferUrl,
        status: 'active'
      }
    });

    console.log(`[checkAndCreateChatroom] New chat created for Order ID: ${orderId}`, newChat);

    // Update order status to 'chat_open'
    const updatedOrder = await prisma.order.update({
      where: { order_id: orderId },
      data: { status: 'chat_open' }
    });

    console.log(`[checkAndCreateChatroom] Order ${orderId} status updated to chat_open`, updatedOrder);

    return { chatroomUrl, acceptOfferUrl };
  } catch (error) {
    console.error(`[checkAndCreateChatroom] Error processing Order ID ${orderId}:`, error);
    throw error;
  }
}

export async function updateAcceptOfferUrl(chatId: number, acceptOfferUrl: string) {
  console.log(`[updateAcceptOfferUrl] Updating accept offer URL for Chat ID: ${chatId}`);
  try {
    const updatedChat = await prisma.chat.update({
      where: { chat_id: chatId },
      data: { accept_offer_url: acceptOfferUrl }
    });

    console.log(`[updateAcceptOfferUrl] Chat updated`, updatedChat);
    return updatedChat;
  } catch (error) {
    console.error(`[updateAcceptOfferUrl] Error updating accept offer URL for Chat ID ${chatId}:`, error);
    throw error;
  }
}