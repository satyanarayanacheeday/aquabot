const { sendTextMessage, markAsRead, downloadMedia } = require('../services/whatsapp');
const { getFarmerByPhone, saveChatHistory, getLatestHealthScore, getFirstPondByFarmer, getRecentPondLogs } = require('../models/database');
const { startOnboarding, handleOnboardingStep } = require('../services/onboarding');
const { startDailyCheckIn, handleDailyStep, getTodayCheckInType, GROUP_MAP } = require('../services/dailyCheckIn');
const { startWeeklyCheckIn, handleWeeklyStep } = require('../services/weeklyCheckIn');
const { startEventFollowUp, handleEventStep, detectEventType } = require('../services/eventFollowUp');
const { handleFollowupStep } = require('../services/followupCheckIn');
const { formatHealthScoreMessage } = require('../services/healthScore');
const { getState, isInFlow } = require('../state/conversationState');
const { answerQuestion } = require('../services/ai');
const { analyzeImage } = require('../services/vision');
const { getWeather } = require('../services/weather');
const logger = require('../utils/logger');

// Input limits
const MAX_MESSAGE_LENGTH = 2000;

/**
 * GET /webhook — Verify webhook with Meta
 */
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed');
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

    // Validate payload structure
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages || value.messages.length === 0) return;

    const message = value.messages[0];
    const phone = message.from;
    const messageId = message.id;
    const messageType = message.type;

    logger.info(`📨 Incoming ${messageType} from ${phone}`);

    // Mark as read
    await markAsRead(messageId);

    // Route based on message type
    if (messageType === 'text') {
      await handleTextMessage(phone, message.text.body);
    } else if (messageType === 'image') {
      await handleImageMessage(phone, message.image);
    } else if (messageType === 'interactive') {
      // Button reply or list reply
      const buttonId = message.interactive?.button_reply?.id;
      const buttonTitle = message.interactive?.button_reply?.title;
      const listId = message.interactive?.list_reply?.id;
      const listTitle = message.interactive?.list_reply?.title;

      const reply = buttonId || listId || buttonTitle || listTitle || '';
      await handleTextMessage(phone, reply);
    } else {
      await sendTextMessage(phone,
        `I can understand text messages and images. 📝📸\n\nPlease send a text question or a photo for disease detection.`
      );
    }
  } catch (error) {
    logger.error('Error handling incoming message', { error: error.message, stack: error.stack });
  }
}

/**
 * Handle text messages — main routing logic
 */
async function handleTextMessage(phone, text) {
  // Input sanitization
  text = sanitizeInput(text);
  if (!text) return;
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.substring(0, MAX_MESSAGE_LENGTH);
  }

  const normalizedText = text.toLowerCase().trim();
  logger.info(`💬 Text from ${phone}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

  // 1. Check if farmer exists
  const farmer = await getFarmerByPhone(phone);
  const { clearState } = require('../state/conversationState');

  // GLOBAL EXIT HANDLER: Allow escaping any flow
  if (['stop', 'exit', 'cancel', 'menu'].includes(normalizedText)) {
    clearState(phone);
    if (normalizedText === 'menu') {
      await sendHelpMessage(phone);
    } else {
      await sendTextMessage(phone, '❌ Flow cancelled. You are now back in normal chat mode.');
    }
    return;
  }

  // 2. Not onboarded → handle onboarding
  if (!farmer || !farmer.onboarding_complete) {
    if (isInFlow(phone)) {
      const state = getState(phone);
      if (state.flow === 'onboarding') {
        await handleOnboardingStep(phone, text);
        return;
      }
    }
    // Start fresh onboarding
    await startOnboarding(phone);
    return;
  }

  // 3. In an active flow → continue that flow
  if (isInFlow(phone)) {
    const state = getState(phone);
    const flow = state.flow;

    if (flow === 'onboarding') {
      await handleOnboardingStep(phone, text);
      return;
    }
    if (flow === 'daily_feed' || flow === 'daily_water' || flow === 'daily_health') {
      await handleDailyStep(phone, text, flow);
      return;
    }
    if (flow === 'weekly_checkin') {
      await handleWeeklyStep(phone, text);
      return;
    }
    if (flow === 'event_followup') {
      await handleEventStep(phone, text);
      return;
    }
    if (flow === 'followup_checkin') {
      await handleFollowupStep(phone, text);
      return;
    }
  }

  // 4. Handle initial help selection from onboarding (prob_ prefix)
  if (normalizedText.startsWith('prob_')) {
    const problem = normalizedText.replace('prob_', '');
    const { deliverImmediateValue } = require('../services/immediateValue');
    await deliverImmediateValue(phone, farmer.id, farmer.village, problem, farmer.preferred_language);
    return;
  }

  // 5. Keyword triggers
  if (normalizedText === 'help' || normalizedText === 'menu') {
    await sendHelpMessage(phone);
    return;
  }

  if (normalizedText === 'score' || normalizedText === 'health' || normalizedText === 'status') {
    await showHealthScore(phone, farmer.id);
    return;
  }

  if (normalizedText === 'weather') {
    await showWeather(phone, farmer.village);
    return;
  }

  if (normalizedText === 'checkin' || normalizedText === 'check-in' || normalizedText === 'update') {
    const checkInType = getTodayCheckInType();
    if (checkInType) {
      await startDailyCheckIn(phone, farmer.id, checkInType);
    } else {
      // Default to feed if not a scheduled day
      await startDailyCheckIn(phone, farmer.id, 'daily_feed');
    }
    return;
  }

  if (normalizedText === 'weekly' || normalizedText === 'report') {
    await startWeeklyCheckIn(phone, farmer.id);
    return;
  }

  // 6. Detect event-based problems from message content
  const eventType = detectEventType(text);
  if (eventType) {
    await startEventFollowUp(phone, farmer.id, eventType, text);
    return;
  }

  // 7. Default: AI Q&A (RAG)
  logger.info(`🤖 Routing to AI Q&A for: "${text.substring(0, 80)}"`);
  let answer;
  try {
    answer = await answerQuestion(text, farmer.id, farmer.preferred_language);
  } catch (err) {
    answer = `I'm having trouble right now. Please try again in a moment.\n\nIf urgent, consult your local aquaculture expert. 🙏`;
  }

  // Save chat history
  try {
    await saveChatHistory({
      farmer_id: farmer.id,
      message: text,
      response: answer,
      message_type: 'text',
    });
  } catch (err) {
    logger.warn('Could not save chat history', { error: err.message });
  }

  await sendTextMessage(phone, answer);
}

/**
 * Handle image messages — disease detection
 */
async function handleImageMessage(phone, imageData) {
  logger.info(`📸 Image from ${phone}`);

  const farmer = await getFarmerByPhone(phone);
  if (!farmer || !farmer.onboarding_complete) {
    await sendTextMessage(phone, 'Please complete your setup first! Send any text to get started.');
    return;
  }

  await sendTextMessage(phone, '🔬 Analyzing your image... Please wait.');

  try {
    const imageBuffer = await downloadMedia(imageData.id);

    // Build pond context for personalized analysis
    let pondContext = null;
    try {
      const pond = await getFirstPondByFarmer(farmer.id);
      if (pond) {
        pondContext = {
          species: pond.species,
          pondSize: pond.pond_size,
        };

        // Add health score
        const healthScore = await getLatestHealthScore(pond.id);
        if (healthScore) {
          pondContext.healthScore = healthScore.score;
        }

        // Add recent issues from logs
        const recentLogs = await getRecentPondLogs(pond.id, null, 5);
        const issues = [];
        for (const log of recentLogs) {
          const d = log.log_data;
          if (d.disease_signs && d.disease_signs !== 'none') issues.push(`disease: ${d.disease_signs}`);
          if (d.water_color === 'brown_black') issues.push('brown/black water');
          if (d.bad_smell === 'strong') issues.push('strong pond smell');
          if (d.event_type) issues.push(`event: ${d.event_type}`);
        }
        if (issues.length > 0) pondContext.recentIssues = issues;
      }
    } catch (ctxErr) {
      logger.warn('Could not build pond context for image', { error: ctxErr.message });
    }

    const analysis = await analyzeImage(imageBuffer, farmer.preferred_language, pondContext);

    try {
      await saveChatHistory({
        farmer_id: farmer.id,
        message: '[Image uploaded for disease detection]',
        response: analysis,
        message_type: 'image',
      });
    } catch (err) {
      logger.warn('Could not save image chat history', { error: err.message });
    }

    await sendTextMessage(phone, `🔬 *Image Analysis*\n\n${analysis}`);
  } catch (error) {
    logger.error('Image analysis failed', { error: error.message, phone });
    await sendTextMessage(phone,
      `Sorry, I couldn't analyze this image. Please try again with a clearer photo.\n\n` +
      `💡 Tip: Take the photo in good lighting with the shrimp/fish clearly visible.`
    );
  }
}

/**
 * Show pond health score
 */
async function showHealthScore(phone, farmerId) {
  try {
    const pond = await getFirstPondByFarmer(farmerId);
    if (!pond) {
      await sendTextMessage(phone, '📊 No pond data yet. Complete a check-in first!');
      return;
    }

    const scoreData = await getLatestHealthScore(pond.id);
    const msg = formatHealthScoreMessage(scoreData);
    await sendTextMessage(phone, msg);
  } catch (err) {
    logger.error('Health score fetch failed', { error: err.message });
    await sendTextMessage(phone, '⚠️ Could not fetch health score. Try again later.');
  }
}

/**
 * Show weather for farmer's village
 */
async function showWeather(phone, village) {
  try {
    const weather = await getWeather(village);
    if (!weather) {
      await sendTextMessage(phone, '⚠️ Could not fetch weather. Try again later.');
      return;
    }

    let msg = `☀️ *Weather in ${weather.location}*\n\n`;
    msg += `🌡️ Temperature: ${weather.temperature}°C (feels like ${weather.feelsLike}°C)\n`;
    msg += `💧 Humidity: ${weather.humidity}%\n`;
    msg += `🌬️ Wind: ${weather.windSpeed} m/s\n`;
    msg += `☁️ ${weather.description}\n`;

    if (weather.rainfall > 0) {
      msg += `🌧️ Rain: ${weather.rainfall} mm/h\n`;
    }

    // Pond-specific weather advice
    if (weather.rainfall > 5) {
      msg += `\n⚠️ *Heavy rain!* Reduce feeding by 20-30%. Watch DO levels.`;
    } else if (weather.temperature > 33) {
      msg += `\n⚠️ *Very hot!* Watch for pH spikes and algae blooms.`;
    } else if (weather.temperature < 25) {
      msg += `\n⚠️ *Cool weather.* Shrimp may eat less — reduce feed accordingly.`;
    }

    await sendTextMessage(phone, msg);
  } catch (err) {
    logger.error('Weather fetch failed', { error: err.message });
    await sendTextMessage(phone, '⚠️ Could not fetch weather. Try again later.');
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
    `📝 *Check-In* — Type "update" to log pond data\n` +
    `📋 *Weekly Report* — Type "weekly" for your weekly check\n` +
    `📊 *Health Score* — Type "score" to see pond status\n` +
    `🌤️ *Weather* — Type "weather" for local weather\n` +
    `❓ *Help* — Type "help" to see this menu\n\n` +
    `I'll also check in with you on:\n` +
    `🍽️ Monday — Feed\n` +
    `💧 Wednesday — Water\n` +
    `🔬 Friday — Health\n` +
    `📋 Sunday — Weekly summary\n\n` +
    `Just start typing! 💬`
  );
}

/**
 * Sanitize user input — strip control characters, trim whitespace
 */
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  // Remove control characters (except newline)
  return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
}

module.exports = {
  verifyWebhook,
  handleIncoming,
};
