const { sendTextMessage, sendListMessage, markAsRead, downloadMedia } = require('../services/whatsapp');
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
      const farmer = await getFarmerByPhone(phone);
      const lang = farmer?.preferred_language || 'English';
      await sendTextMessage(phone, t('msg_unsupported', lang));
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
  const { markPendingCheckInsCompleted } = require('../models/database');

  if (farmer && farmer.onboarding_complete) {
    // Farmer is interacting, clear any skipped automated check-ins in the background
    markPendingCheckInsCompleted(farmer.id).catch(err => {
      logger.error('Failed to clear pending check-ins', { error: err.message });
    });
  }

  // GLOBAL EXIT HANDLER: Allow escaping any flow
  if (['stop', 'exit', 'cancel', 'menu'].includes(normalizedText)) {
    const lang = farmer?.preferred_language || 'English';
    clearState(phone);
    if (normalizedText === 'menu') {
      await sendHelpMessage(phone);
    } else {
      await sendTextMessage(phone, t('msg_cancelled', lang));
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

    // --- NEW: Handle Feed Plan Count Input ---
    if (flow === 'awaiting_feed_count') {
      const { getFeedPlan, parseUserCount } = require('../services/feedPlan');
      const lang = farmer.preferred_language || 'English';
      const abw = parseUserCount(text);
      
      if (!abw) {
        await sendTextMessage(phone, lang === 'Telugu' ? 'క్షమించండి, ఆ నంబర్ నాకు అర్థం కాలేదు. దయచేసి మీ రొయ్యల కౌంట్ (ఉదా: 100) తెలియజేయండి.' : 
               (lang === 'Hindi' ? 'क्षमा करें, मुझे वह नंबर समझ नहीं आया। कृपया अपना झींगा काउंट (जैसे: 100) बताएं।' : 
               'Sorry, I didn\'t catch that number. Please tell me your shrimp count (e.g., 100 count).'));
        return;
      }

      const plan = await getFeedPlan(farmer.id, lang, abw);
      if (plan && plan.type === 'success') {
        await sendTextMessage(phone, plan.message);
        clearState(phone);
        
        // Save to history
        saveChatHistory({
          farmer_id: farmer.id,
          message: `[Count provided: ${text}]`,
          response: plan.message,
          message_type: 'feed_plan',
        }).catch(() => {});
      } else {
        await sendTextMessage(phone, plan?.message || 'Error calculating plan.');
        clearState(phone);
      }
      return;
    }
    // ------------------------------------------


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

  // 4. Handle topic selection from menu (prob_ prefix)
  if (normalizedText.startsWith('prob_')) {
    const topic = normalizedText.replace('prob_', '');
    
    // NEW: Handle Feed Plan specifically
    if (topic === 'feed_plan') {
      const lang = farmer.preferred_language || 'English';
      const q = lang === 'Telugu' ? 'మీ రొయ్యల ప్రస్తుత కౌంట్ ఎంత? (ఉదాహరణకు: 100 కౌంట్ లేదా 10 గ్రాములు)' : 
               (lang === 'Hindi' ? 'आपका झींगा काउंट कितना है? (उदाहरण: 100 काउंट या 10 ग्राम)' : 
               'To give you an accurate plan, what is your current shrimp count (e.g., 100 count) or size in grams?');
      
      setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
      await sendTextMessage(phone, q);
      return;
    }


    if (['disease', 'mortality', 'slow_growth', 'growth', 'water_quality', 'water', 'feed'].includes(topic)) {

      // Map 'water' to 'water_quality' and 'growth' to 'slow_growth'
      let eventType = topic;
      if (topic === 'water') eventType = 'water_quality';
      if (topic === 'growth') eventType = 'slow_growth';
      
      await startEventFollowUp(phone, farmer.id, eventType);
      return;
    }

    // Default: Deliver immediate value (tips) for other topics
    const { deliverImmediateValue } = require('../services/immediateValue');
    await deliverImmediateValue(phone, farmer.id, farmer.village, topic, farmer.preferred_language);
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


  // 6. GREETING INTERCEPTOR: Friendly welcome with topic selection
  const greetings = ['hi', 'hii', 'hello', 'hey', 'namaste', 'namaskaram', 'good morning', 'gm', 'good evening'];
  if (greetings.includes(normalizedText)) {
    const lang = farmer.preferred_language || 'English';
    const greetingsConfig = {
      English: {
        text: `Hi! 👋 I'm your aquaIQ assistant.\n\n💡 *How can I help you today?*\nSelect a topic below to get started immediately:`,
        button: 'Select Topic',
        topics: [
           { id: 'prob_disease', title: '🔬 Disease', desc: 'Identification & Prevention' },
          { id: 'prob_feed_plan', title: '🍽️ Feed Plan', desc: 'Daily Feed Calculator' },
          { id: 'prob_water_quality', title: '💧 Water Quality', desc: 'Management Advice' },
          { id: 'prob_slow_growth', title: '📈 Slow Growth', desc: 'Growth & Weight Issues' },
          { id: 'prob_mortality', title: '⚠️ Mortality', desc: 'Handling Losses' }


        ]
      },
      Telugu: {
        text: `నమస్కారం! 👋 నేను మీ aquaIQ అసిస్టెంట్‌ని.\n\n💡 *ఈరోజు నేను మీకు ఎలా సహాయపడగలను?*\nవెంటనే ప్రారంభించడానికి దిగువన ఒక అంశాన్ని ఎంచుకోండి:`,
        button: 'అంశాన్ని ఎంచుకోండి',
        topics: [
           { id: 'prob_disease', title: '🔬 వ్యాధి', desc: 'గుర్తింపు మరియు నివారణ' },
          { id: 'prob_feed_plan', title: '🍽️ మేత ప్రణాళిక', desc: 'రోజువారీ మేత కాలిక్యులేటర్' },
          { id: 'prob_water_quality', title: '💧 నీటి నాణ్యత', desc: 'నిర్వహణ సలహా' },
          { id: 'prob_slow_growth', title: '📈 నెమ్మదిగా పెరుగుదల', desc: 'పెరుగుదల మరియు బరువు సమస్యలు' },
          { id: 'prob_mortality', title: '⚠️ మరణాలు', desc: 'నష్టాలను ఎదుర్కోవడం' }


        ]
      },
      Hindi: {
        text: `नमस्ते! 👋 मैं आपका aquaIQ सहायक हूँ।\n\n💡 *आज मैं आपकी क्या मदद कर सकता हूँ?*\nतुरंत शुरू करने के लिए नीचे एक विषय चुनें:`,
        button: 'विषय चुनें',
        topics: [
           { id: 'prob_disease', title: '🔬 रोग', desc: 'पहचान और रोकथाम' },
          { id: 'prob_feed_plan', title: '🍽️ फीड प्लान', desc: 'दैनिक चारा कैलकुलेटर' },
          { id: 'prob_water_quality', title: '💧 पानी की गुणवत्ता', desc: 'प्रबंधन सलाह' },
          { id: 'prob_slow_growth', title: '📈 धीमी वृद्धि', desc: 'विकास और वजन संबंधी समस्याएं' },
          { id: 'prob_mortality', title: '⚠️ मृत्यु दर', desc: 'नुकसान से निपटना' }


        ]
      }
    };

    const config = greetingsConfig[lang] || greetingsConfig['English'];
    
    await sendListMessage(phone, config.text, config.button, [
      {
        title: lang === 'Telugu' ? 'సహాయం కోసం అంశాలు' : (lang === 'Hindi' ? 'सहायता विषय' : 'Help Topics'),
        rows: config.topics.map(t => ({
          id: t.id,
          title: t.title,
          description: t.desc
        }))
      }
    ]);
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
  const lang = farmer?.preferred_language || 'English';
  try {
    answer = await answerQuestion(text, farmer.id, lang);
  } catch (err) {
    answer = t('err_ai_qa', lang);
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
  const lang = farmer?.preferred_language || 'English';

  if (!farmer || !farmer.onboarding_complete) {
    await sendTextMessage(phone, t('msg_setup_first', lang));
    return;
  }

  await sendTextMessage(phone, t('msg_analyzing_img', lang));

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

    await sendTextMessage(phone, `${t('msg_img_analysis_header', lang)}${analysis}`);
  } catch (error) {
    logger.error('Image analysis failed', { error: error.message, phone });
    await sendTextMessage(phone, t('msg_img_fail', lang));
  }
}

/**
 * Show pond health score
 */
async function showHealthScore(phone, farmerId) {
  const farmer = await getFarmerByPhone(phone);
  const lang = farmer?.preferred_language || 'English';

  try {
    const pond = await getFirstPondByFarmer(farmerId);
    if (!pond) {
      await sendTextMessage(phone, t('msg_no_pond_data', lang));
      return;
    }

    const scoreData = await getLatestHealthScore(pond.id);
    const msg = formatHealthScoreMessage(scoreData, lang);
    await sendTextMessage(phone, msg);
  } catch (err) {
    logger.error('Health score fetch failed', { error: err.message });
    await sendTextMessage(phone, t('err_health_score', lang));
  }
}


/**
 * Send help/menu message
 */
async function sendHelpMessage(phone) {
  const farmer = await getFarmerByPhone(phone);
  const lang = farmer?.preferred_language || 'English';

  await sendTextMessage(phone,
    `${t('msg_help_header', lang)}\n\n` +
    `${t('msg_help_qa', lang)}\n` +
    `${t('msg_help_disease', lang)}\n` +
    `${t('msg_help_update', lang)}\n` +
    `${t('msg_help_weekly', lang)}\n` +
    `${t('msg_help_score', lang)}\n` +
    `${t('msg_help_help', lang)}\n\n` +
    `${t('msg_help_schedule', lang)}\n` +
    `${t('msg_help_monday', lang)}\n` +
    `${t('msg_help_wednesday', lang)}\n` +
    `${t('msg_help_friday', lang)}\n` +
    `${t('msg_help_sunday', lang)}\n\n` +
    `${t('msg_help_footer', lang)}`
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

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    msg_unsupported: 'I can understand text messages and images. 📝📸\n\nPlease send a text question or a photo for disease detection.',
    msg_cancelled: '❌ Flow cancelled. You are now back in normal chat mode.',
    msg_setup_first: 'Please complete your setup first! Send any text to get started.',
    msg_analyzing_img: '🔬 Analyzing your image... Please wait.',
    msg_img_analysis_header: '🔬 *Image Analysis*\n\n',
    msg_img_fail: 'Sorry, I couldn\'t analyze this image. Please try again with a clearer photo.\n\n💡 Tip: Take the photo in good lighting with the shrimp/fish clearly visible.',
    msg_no_pond_data: '📊 No pond data yet. Complete a check-in first!',
    err_health_score: '⚠️ Could not fetch health score. Try again later.',
    err_ai_qa: 'I\'m having trouble right now. Please try again in a moment.\n\nIf urgent, consult your local aquaculture expert. 🙏',
    msg_help_header: '🦐 *aquaIQ — Your Pond Assistant*\n\nHere\'s what I can do:',
    msg_help_qa: '💬 *Ask Questions* — Just type any farming question',
    msg_help_disease: '📸 *Disease Detection* — Send a shrimp/fish photo',
    msg_help_update: '📝 *Check-In* — Type "update" to log pond data',
    msg_help_weekly: '📋 *Weekly Report* — Type "weekly" for your weekly check',
    msg_help_score: '📊 *Health Score* — Type "score" to see pond status',
    msg_help_help: '❓ *Help* — Type "help" to see this menu',
    msg_help_schedule: 'I\'ll also check in with you on:',
    msg_help_monday: '🍽️ Monday — Feed',
    msg_help_wednesday: '💧 Wednesday — Water',
    msg_help_friday: '🔬 Friday — Health',
    msg_help_sunday: '📋 Sunday — Weekly summary',
    msg_help_footer: 'Just start typing! 💬'
  },
  Telugu: {
    msg_unsupported: 'నేను టెక్స్ట్ సందేశాలు మరియు చిత్రాలను అర్థం చేసుకోగలను. 📝📸\n\nదయచేసి వ్యాధి గుర్తింపు కోసం ప్రశ్న లేదా ఫోటోను పంపండి.',
    msg_cancelled: '❌ ప్రక్రియ రద్దు చేయబడింది. మీరు ఇప్పుడు సాధారణ చాట్ మోడ్‌లో ఉన్నారు.',
    msg_setup_first: 'దయచేసి ముందుగా మీ సెటప్ పూర్తి చేయండి! ప్రారంభించడానికి ఏదైనా టెక్స్ట్ పంపండి.',
    msg_analyzing_img: '🔬 మీ చిత్రాన్ని విశ్లేషిస్తున్నాను... దయచేసి వేచి ఉండండి.',
    msg_img_analysis_header: '🔬 *చిత్ర విశ్లేషణ*\n\n',
    msg_img_fail: 'క్షమించండి, నేను ఈ చిత్రాన్ని విశ్లేషించలేకపోయాను. దయచేసి స్పష్టమైన ఫోటోతో మళ్ళీ ప్రయత్నించండి.\n\n💡 చిట్కా: రొయ్యలు/చేపలు స్పష్టంగా కనిపించేలా మంచి వెలుతురులో ఫోటో తీయండి.',
    msg_no_pond_data: '📊 ఇంకా చెరువు డేటా లేదు. మొదట ఒకసారి చెక్-ఇన్ పూర్తి చేయండి!',
    err_health_score: '⚠️ హెల్త్ స్కోర్‌ని పొందడం సాధ్యం కాలేదు. తర్వాత మళ్ళీ ప్రయత్నించండి.',
    err_ai_qa: 'ప్రస్తుతం నాకు చిన్న సమస్య ఎదురైంది. దయచేసి కాసేపటి తర్వాత మళ్ళీ ప్రయత్నించండి.\n\nఅత్యవసరమైతే, మీ స్థానిక ఆక్వాకల్చర్ నిపుణుడిని సంప్రదించండి. 🙏',
    msg_help_header: '🦐 *aquaIQ — మీ చెరువు సహాయకుడు*\n\nనేను ఏమి చేయగలనో ఇక్కడ ఉంది:',
    msg_help_qa: '💬 *ప్రశ్నలు అడగండి* — ఏదైనా సాగు ప్రశ్నను టైప్ చేయండి',
    msg_help_disease: '📸 *వ్యాధి గుర్తింపు* — రొయ్యల/చేపల ఫోటో పంపండి',
    msg_help_update: '📝 *చెక్-ఇన్* — డేటాను నమోదు చేయడానికి "update" అని టైప్ చేయండి',
    msg_help_weekly: '📋 *వారపు నివేదిక* — వారపు తనిఖీ కోసం "weekly" అని టైప్ చేయండి',
    msg_help_score: '📊 *హెల్త్ స్కోర్* — చెరువు స్థితిని చూడటానికి "score" అని టైప్ చేయండి',
    msg_help_help: '❓ *సహాయం* — ఈ మెనూ చూడటానికి "help" అని టైప్ చేయండి',
    msg_help_schedule: 'నేను వీటిపై కూడా మిమ్మల్ని సంప్రదిస్తాను:',
    msg_help_monday: '🍽️ సోమవారం — మేత',
    msg_help_wednesday: '💧 బుధవారం — నీరు',
    msg_help_friday: '🔬 శుక్రవారం — ఆరోగ్యం',
    msg_help_sunday: '📋 ఆదివారం — వారపు సారాంశం',
    msg_help_footer: 'టైప్ చేయడం ప్రారంభించండి! 💬'
  },
  Hindi: {
    msg_unsupported: 'मैं टेक्स्ट संदेशों और छवियों को समझ सकता हूँ। 📝📸\n\nकृपया रोग की पहचान के लिए एक प्रश्न या फोटो भेजें।',
    msg_cancelled: '❌ प्रक्रिया रद्द कर दी गई। अब आप सामान्य चैट मोड में हैं।',
    msg_setup_first: 'कृपया पहले अपना सेटअप पूरा करें! शुरू करने के लिए कोई भी टेक्स्ट भेजें।',
    msg_analyzing_img: '🔬 आपकी छवि का विश्लेषण कर रहा हूँ... कृपया प्रतीक्षा करें।',
    msg_img_analysis_header: '🔬 *छवि विश्लेषण*\n\n',
    msg_img_fail: 'क्षमा करें, मैं इस छवि का विश्लेषण नहीं कर सका। कृपया स्पष्ट फोटो के साथ पुनः प्रयास करें।\n\n💡 टिप: झींगा/मछली स्पष्ट रूप से दिखाई देने के लिए अच्छी रोशनी में फोटो लें।',
    msg_no_pond_data: '📊 अभी तक कोई तालाब डेटा नहीं है। पहले एक चेक-इन पूरा करें!',
    err_health_score: '⚠️ हेल्थ स्कोर नहीं मिल सका। बाद में पुनः प्रयास करें।',
    err_ai_qa: 'मुझे अभी कुछ समस्या हो रही है। कृपया कुछ देर बाद पुनः प्रयास करें।\n\nयदि आवश्यक हो, तो अपने स्थानीय जलीय कृषि विशेषज्ञ से परामर्श करें। 🙏',
    msg_help_header: '🦐 *aquaIQ — आपका तालाब सहायक*\n\nयहाँ मैं क्या कर सकता हूँ:',
    msg_help_qa: '💬 *प्रश्न पूछें* — बस कोई भी खेती से जुड़ा प्रश्न टाइप करें',
    msg_help_disease: '📸 *रोग पहचान* — झींगा/मछली की फोटो भेजें',
    msg_help_update: '📝 *चेक-इन* — डेटा लॉग करने के लिए "update" टाइप करें',
    msg_help_weekly: '📋 *साप्ताहिक रिपोर्ट* — साप्ताहिक जांच के लिए "weekly" टाइप करें',
    msg_help_score: '📊 *हेल्थ स्कोर* — तालाब की स्थिति देखने के लिए "score" टाइप करें',
    msg_help_help: '❓ *सहायता* — यह मेनू देखने के लिए "help" टाइप करें',
    msg_help_schedule: 'मैं आपसे इन पर भी संपर्क करूँगा:',
    msg_help_monday: '🍽️ सोमवार — चारा',
    msg_help_wednesday: '💧 बुधवार — पानी',
    msg_help_friday: '🔬 शुक्रवार — स्वास्थ्य',
    msg_help_sunday: '📋 रविवार — साप्ताहिक सारांश',
    msg_help_footer: 'बस टाइप करना शुरू करें! 💬'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  verifyWebhook,
  handleIncoming,
  translations,
  t
};
