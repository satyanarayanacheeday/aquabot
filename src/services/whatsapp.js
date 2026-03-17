const axios = require('axios');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

const eventBus = require('../utils/eventBus');

/**
 * Helper to emit messages to the local test UI if running in test mode
 */
function emitToTestUI(to, text) {
  eventBus.emit('message', { to, text });
}

/**
 * Send a plain text message via WhatsApp Cloud API
 */
async function sendTextMessage(to, text) {
  // === TEST MODE INTERCEPT ===
  // If the token contains "your_whatsapp_access_token", assume we are purely testing locally
  if (process.env.WHATSAPP_TOKEN.includes('your_') || !process.env.WHATSAPP_TOKEN) {
    console.log(`\n[LOCAL UI DEV] 🤖 Bot reply to ${to}:\n${text}\n`);
    
    emitToTestUI(to, text);
    return { ok: true, mocked: true };
  }
  // ===========================

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`✅ Message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send message to ${to}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send an interactive button message
 */
async function sendButtonMessage(to, bodyText, buttons) {
  // === TEST MODE INTERCEPT ===
  if (process.env.WHATSAPP_TOKEN.includes('your_') || !process.env.WHATSAPP_TOKEN) {
    let mockText = `${bodyText}\n\n[Buttons Options]:\n`;
    buttons.forEach((b, i) => mockText += `${i+1}️⃣ ${b.title}\n`);
    mockText += `\n(Type one of the options above to simulate a click)`;

    console.log(`\n[LOCAL UI DEV] 🤖 Bot button reply to ${to}:\n${mockText}\n`);
    emitToTestUI(to, mockText);
    return { ok: true, mocked: true };
  }
  // ===========================

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const buttonPayload = buttons.map((btn, i) => ({
    type: 'reply',
    reply: { id: btn.id || `btn_${i}`, title: btn.title.substring(0, 20) },
  }));

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: buttonPayload },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`✅ Button message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send button message to ${to}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Download media (image) from WhatsApp
 * Returns the image as a Buffer
 */
async function downloadMedia(mediaId) {
  const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };

  try {
    // Step 1: Get media URL
    const mediaInfo = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      { headers }
    );

    const mediaUrl = mediaInfo.data.url;

    // Step 2: Download the actual media file
    const mediaResponse = await axios.get(mediaUrl, {
      headers,
      responseType: 'arraybuffer',
    });

    return Buffer.from(mediaResponse.data);
  } catch (error) {
    console.error('❌ Failed to download media:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Mark a message as read
 */
async function markAsRead(messageId) {
  // === TEST MODE INTERCEPT ===
  if (process.env.WHATSAPP_TOKEN.includes('your_') || !process.env.WHATSAPP_TOKEN) {
    return { ok: true, mocked: true };
  }
  // ===========================

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Non-critical, just log
    console.warn('⚠️ Could not mark message as read:', error.message);
  }
}

module.exports = {
  sendTextMessage,
  sendButtonMessage,
  downloadMedia,
  markAsRead,
};
