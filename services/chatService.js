// services/chatService.js

import fetch from 'node-fetch';

const CHAT_APP_URL = 'http://localhost:3456';

export async function createChatroom() {
  const response = await fetch(`${CHAT_APP_URL}/ui/chat/make-offer`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to create chatroom');
  }

  const { token } = await response.json();
  return `${CHAT_APP_URL}/ui/chat/room/${token}`;
}
