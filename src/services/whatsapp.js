const axios = require('axios');
const FormData = require('form-data');

const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

const eventBus = require('../utils/eventBus');

/**
 * Helper to emit messages to the local test UI if running in test mode
 */
function emitToTestUI(to, text) {
  eventBus.emit('message', { to, text });
}

/**
 * Check if we are in local test mode (no real WhatsApp token)
 */
function isTestMode() {
  return !process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN.includes('your_');
}

/**
 * Send a plain text message via WhatsApp Cloud API
 */
async function sendTextMessage(to, text) {
  if (isTestMode()) {
    console.log(`\n[LOCAL] 🤖 Reply to ${to}:\n${text}\n`);
    emitToTestUI(to, text);
    return { ok: true, mocked: true };
  }

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
 * Send an interactive button message (max 3 buttons)
 */
async function sendButtonMessage(to, bodyText, buttons) {
  if (isTestMode()) {
    let mockText = `${bodyText}\n\n`;
    buttons.forEach((b) => mockText += `[${b.title}] `);
    mockText += `\n\n(Type one of the options above)`;

    console.log(`\n[LOCAL] 🤖 Buttons to ${to}:\n${mockText}\n`);
    emitToTestUI(to, mockText);
    return { ok: true, mocked: true };
  }

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
 * Send an interactive list message (up to 10 options)
 * Used for species selection, problem selection, etc.
 */
async function sendListMessage(to, bodyText, buttonText, sections) {
  if (isTestMode()) {
    let mockText = `${bodyText}\n\n📋 Options:\n`;
    sections.forEach((section) => {
      if (section.title) mockText += `\n*${section.title}*\n`;
      section.rows.forEach((row, i) => {
        mockText += `  ${i + 1}. ${row.title}`;
        if (row.description) mockText += ` — ${row.description}`;
        mockText += `\n`;
      });
    });
    mockText += `\n(Type one of the options above)`;

    console.log(`\n[LOCAL] 🤖 List to ${to}:\n${mockText}\n`);
    emitToTestUI(to, mockText);
    return { ok: true, mocked: true };
  }

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonText.substring(0, 20),
            sections: sections.map(s => ({
              title: s.title ? s.title.substring(0, 24) : undefined,
              rows: s.rows.map(r => ({
                id: r.id,
                title: r.title.substring(0, 24),
                description: r.description ? r.description.substring(0, 72) : undefined,
              })),
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`✅ List message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send list message to ${to}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Download media (image) from WhatsApp
 * Returns the image as a Buffer
 */
const recordedAudios = new Map();

function saveRecordedAudio(mediaId, buffer) {
  recordedAudios.set(mediaId, buffer);
}

const generatedAudios = new Map();

function saveGeneratedAudio(mediaId, buffer) {
  generatedAudios.set(mediaId, buffer);
}

function getGeneratedAudio(mediaId) {
  return generatedAudios.get(mediaId);
}

async function downloadMedia(mediaId) {
  if (recordedAudios.has(mediaId)) {
    console.log(`\n[LOCAL] 📥 Loading recorded audio buffer for: ${mediaId}\n`);
    return recordedAudios.get(mediaId);
  }

  if (isTestMode() || (mediaId && mediaId.startsWith('mock_'))) {
    console.log(`\n[LOCAL] 📥 Mock media download for: ${mediaId}\n`);
    return Buffer.alloc(10000); // 10KB dummy buffer
  }

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
  if (isTestMode() || (messageId && messageId.startsWith('mock_'))) {
    return { ok: true, mocked: true };
  }

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

/**
 * Upload media (audio) to WhatsApp Cloud API
 * Returns the media_id for use in sending audio messages
 * @param {Buffer} buffer - The audio file buffer
 * @param {string} mimeType - MIME type (e.g., 'audio/wav', 'audio/ogg')
 * @param {string} filename - Filename with extension
 * @returns {Promise<string>} media_id from WhatsApp
 */
async function uploadMediaToWhatsApp(buffer, mimeType, filename) {
  if (isTestMode()) {
    const mediaId = 'mock_media_id_' + Date.now();
    console.log(`\n[LOCAL] 📤 Mock media upload: ${filename} (${buffer.length} bytes, ${mimeType})\n`);
    saveGeneratedAudio(mediaId, buffer);
    return mediaId;
  }

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`;

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', buffer, {
    filename: filename,
    contentType: mimeType,
  });
  form.append('type', mimeType);

  try {
    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      timeout: 30000,
    });

    const mediaId = response.data.id;
    console.log(`✅ Media uploaded: ${mediaId}`);
    return mediaId;
  } catch (error) {
    console.error('❌ Failed to upload media:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send an audio message via WhatsApp Cloud API
 * @param {string} to - Recipient phone number
 * @param {string} mediaId - Media ID from uploadMediaToWhatsApp
 */
async function sendAudioMessage(to, mediaId) {
  if (isTestMode()) {
    console.log(`\n[LOCAL] 🔊 Audio reply to ${to} (mediaId: ${mediaId})\n`);
    emitToTestUI(to, `🔊 [Audio Response]<br><audio controls src="/api/test/audio/${mediaId}"></audio>`);
    return { ok: true, mocked: true };
  }

  const url = `${WHATSAPP_API_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'audio',
        audio: { id: mediaId },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`✅ Audio message sent to ${to}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send audio to ${to}:`, error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  downloadMedia,
  markAsRead,
  uploadMediaToWhatsApp,
  sendAudioMessage,
  saveRecordedAudio,
  getGeneratedAudio,
};
