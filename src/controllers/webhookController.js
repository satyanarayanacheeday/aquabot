const { sendTextMessage, markAsRead, downloadMedia } = require('../services/whatsapp');
const { getFarmerByPhone, saveChatHistory } = require('../models/database');
const { startRegistration, handleRegistrationStep } = require('../services/registration');
const { startDailyCollection, handleDailyStep, startWeeklyCollection, handleWeeklyStep } = require('../services/dataCollection');
const { getState, isInFlow } = require('../state/conversationState');
const { answerQuestion } = require('../services/ai');
const { analyzeImage } = require('../services/vision');

/**
 * GET /webhook — Verify webhook with Meta
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification failed');
  return res.sendStatus(403);
}

/**
 * POST /webhook — Handle incoming WhatsApp messages
 */
async function handleIncoming(req, res) {
  // Always respond 200 quickly to avoid Meta retries
  res.sendStatus(200);

  try {
    const body = req.body;
    console.log('handleIncoming: Starting payload validation');

    // Validate payload structure
    if (body.object !== 'whatsapp_business_account') {
      console.log('handleIncoming: Invalid object type:', body.object);
      return;
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    console.log('handleIncoming: Extracted changes value');

    // Check for messages (not status updates)
    if (!value?.messages || value.messages.length === 0) {
      console.log('handleIncoming: No messages in payload');
      return;
    }

    const message = value.messages[0];
    const phone = message.from;
    const messageId = message.id;
    const messageType = message.type;

    console.log(`\n📨 Incoming ${messageType} from ${phone}`);

    // Mark as read
    console.log('handleIncoming: Calling markAsRead');
    await markAsRead(messageId);
    console.log('handleIncoming: markAsRead successful');

    // Route based on message type
    if (messageType === 'text') {
      console.log('handleIncoming: Routing to handleTextMessage');
      await handleTextMessage(phone, message.text.body);
    } else if (messageType === 'image') {
      console.log('handleIncoming: Routing to handleImageMessage');
      await handleImageMessage(phone, message.image);
    } else if (messageType === 'interactive') {
      console.log('handleIncoming: Routing interactive to handleTextMessage');
      // Button replies
      const buttonId = message.interactive?.button_reply?.id;
      const buttonTitle = message.interactive?.button_reply?.title;
      await handleTextMessage(phone, buttonId || buttonTitle || '');
    } else {
      console.log('handleIncoming: Unsupported message type');
      await sendTextMessage(phone,
        `I can understand text messages and images. 📝📸\n\nPlease send a text question or a photo for disease detection.`
      );
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
  }
}

/**
 * Handle text messages — route to appropriate flow
 */
async function handleTextMessage(phone, text) {
  const normalizedText = text.toLowerCase().trim();
  console.log(`💬 Text from ${phone}: "${text}"`);

  // 1. Check if farmer exists
  console.log('handleTextMessage: Step 1: Fetching farmer from DB');
  const farmer = await getFarmerByPhone(phone);
  console.log('handleTextMessage: Step 1: Farmer search returned:', farmer?.name || 'NOT_FOUND');

  // 2. If not registered, handle registration only
  if (!farmer || !farmer.registration_complete) {
    console.log('handleTextMessage: Step 2: Registration required/incomplete.');
    
    if (isInFlow(phone)) {
      const state = getState(phone);
      if (state.flow === 'registration') {
        console.log('handleTextMessage: Step 2: Continuing registration flow');
        await handleRegistrationStep(phone, text);
        return;
      }
    }
    
    // Not in flow or in wrong flow, start/restart registration
    console.log('handleTextMessage: Step 2: Starting registration flow');
    await startRegistration(phone);
    return;
  }

  // 3. Registered farmers: check for active data collection flows
  console.log('handleTextMessage: Step 3: Checking active collection flows');
  if (isInFlow(phone)) {
    const state = getState(phone);
    console.log('handleTextMessage: Step 3: Farmer in flow:', state.flow);
    if (state.flow === 'daily_data') {
      await handleDailyStep(phone, text);
      return;
    }
    if (state.flow === 'weekly_data') {
      await handleWeeklyStep(phone, text);
      return;
    }
  }

  console.log('handleTextMessage: Step 4: Checking triggers');
  if (normalizedText === 'update' || normalizedText === 'daily' || normalizedText === 'pond data') {
    console.log('handleTextMessage: Step 4: Daily trigger detected');
    await startDailyCollection(phone, farmer.id);
    return;
  }

  if (normalizedText === 'sampling' || normalizedText === 'weekly' || normalizedText === 'growth' || normalizedText === 'water' || normalizedText === 'report') {
    console.log('handleTextMessage: Step 4: Weekly trigger detected');
    await startWeeklyCollection(phone, farmer.id);
    return;
  }

  if (normalizedText === 'help' || normalizedText === 'menu') {
    console.log('handleTextMessage: Step 4: Help trigger detected');
    await sendHelpMessage(phone);
    return;
  }
  
  console.log('handleTextMessage: Step 5: Routing to AI Q&A');

  console.log('handleTextMessage: Step 5: Calling answerQuestion (Gemini)');
  const answer = await answerQuestion(text, farmer.id, farmer.preferred_language);
  console.log('handleTextMessage: Step 5: Gemini response received');

  // Save chat history
  try {
    console.log('handleTextMessage: Step 6: Saving chat history to DB');
    await saveChatHistory({
      farmer_id: farmer.id,
      message: text,
      response: answer,
      message_type: 'text',
    });
    console.log('handleTextMessage: Step 6: Chat history saved');
  } catch (err) {
    console.warn('⚠️ Could not save chat history:', err.message);
  }

  console.log('handleTextMessage: Step 7: Sending final response to UI');
  await sendTextMessage(phone, answer);
  console.log('✅ Message handled completely.');
}

/**
 * Handle image messages — disease detection
 */
async function handleImageMessage(phone, imageData) {
  console.log(`📸 Image from ${phone}`);

  const farmer = await getFarmerByPhone(phone);
  if (!farmer || !farmer.registration_complete) {
    await sendTextMessage(phone, 'Please complete your registration first! Send any text to get started.');
    return;
  }

  await sendTextMessage(phone, '🔬 Analyzing your image... Please wait.');

  try {
    // Download the image
    const imageBuffer = await downloadMedia(imageData.id);

    // Analyze with Gemini Vision
    const analysis = await analyzeImage(imageBuffer, farmer.preferred_language);

    // Save to chat history
    try {
      await saveChatHistory({
        farmer_id: farmer.id,
        message: '[Image uploaded for disease detection]',
        response: analysis,
        message_type: 'image',
      });
    } catch (err) {
      console.warn('⚠️ Could not save chat history:', err.message);
    }

    await sendTextMessage(phone, `🔬 *Image Analysis*\n\n${analysis}`);
  } catch (error) {
    console.error('❌ Image analysis failed:', error);
    await sendTextMessage(phone,
      `Sorry, I couldn't analyze this image. Please try again with a clearer photo.\n\n` +
      `💡 Tip: Take the photo in good lighting with the shrimp/fish clearly visible.`
    );
  }
}

/**
 * Send help/menu message
 */
async function sendHelpMessage(phone) {
  await sendTextMessage(phone,
    `🦐 *Aquorix — Your Pond Assistant*\n\n` +
    `Here's what I can do:\n\n` +
    `💬 *Ask Questions* — Just type any farming question\n` +
    `📸 *Disease Detection* — Send a shrimp/fish photo\n` +
    `📝 *Daily Update* — Type "update" for today's pond data\n` +
    `📋 *Weekly Report* — Type "sampling" or "water" for growth & water check\n` +
    `❓ *Help* — Type "help" to see this menu\n\n` +
    `You'll also receive:\n` +
    `☀️ Daily data reminders at 6 AM\n` +
    `📊 Weekly report reminders on Monday\n` +
    `📋 Personalized daily advisory at 7 AM\n\n` +
    `Just start typing! 💬`
  );
}

module.exports = {
  verifyWebhook,
  handleIncoming,
};
