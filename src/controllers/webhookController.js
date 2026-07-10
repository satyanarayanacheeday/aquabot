const { sendTextMessage, sendButtonMessage, sendListMessage, markAsRead, downloadMedia, uploadMediaToWhatsApp, sendAudioMessage } = require('../services/whatsapp');
const { transcribeAudio, textToSpeech, shouldGenerateAudio, MIN_AUDIO_SIZE_BYTES } = require('../services/audio');
const eventBus = require('../utils/eventBus');
const { getFarmerByPhone, updateFarmer, saveChatHistory, updateChatHistory, getLatestHealthScore, getFirstPondByFarmer, getRecentPondLogs } = require('../models/database');
const { uploadMedia } = require('../services/storage');
const { startOnboarding, handleOnboardingStep, t: onboardingT } = require('../services/onboarding');
const { startDailyCheckIn, handleDailyStep, getTodayCheckInType, GROUP_MAP } = require('../services/dailyCheckIn');
const { startWeeklyCheckIn, handleWeeklyStep } = require('../services/weeklyCheckIn');
const { startEventFollowUp, handleEventStep, detectEventType } = require('../services/eventFollowUp');
const { handleFollowupStep } = require('../services/followupCheckIn');
const { formatHealthScoreMessage } = require('../services/healthScore');
const { getState, setState, clearState, isInFlow } = require('../state/conversationState');
const { answerQuestion } = require('../services/ai');
const { analyzeImage } = require('../services/vision');
const logger = require('../utils/logger');

/**
 * JIT Species Prompting Helper
 */
async function askSpeciesJIT(phone, speciesType, lang) {
  if (speciesType === 'default_shrimp') {
    await sendButtonMessage(phone, onboardingT('q_shrimp_species', lang), [
      { id: 'spec_vannamei', title: onboardingT('btn_vannamei', lang) },
      { id: 'spec_monodon', title: onboardingT('btn_tiger', lang) }
    ]);
  } else if (speciesType === 'default_fish') {
    await sendListMessage(phone, onboardingT('q_fish_species', lang), onboardingT('btn_select_topic', lang), [
      {
        title: onboardingT('btn_fish', lang),
        rows: [
          { id: 'spec_tilapia', title: onboardingT('btn_tilapia', lang) },
          { id: 'spec_rohu', title: onboardingT('btn_rohu', lang) },
          { id: 'spec_pangasius', title: onboardingT('btn_pangasius', lang) },
          { id: 'spec_catfish', title: onboardingT('btn_catfish', lang) },
          { id: 'spec_seabass', title: onboardingT('btn_seabass', lang) },
          { id: 'spec_murrel', title: onboardingT('btn_murrel', lang) },
          { id: 'spec_other_fish', title: onboardingT('btn_other_fish', lang) }
        ]
      }
    ]);
  } else if (speciesType === 'default_both') {
    await sendListMessage(phone, onboardingT('q_both_species', lang), onboardingT('btn_select_topic', lang), [
      {
        title: onboardingT('btn_shrimp', lang),
        rows: [
          { id: 'spec_vannamei', title: onboardingT('btn_vannamei', lang) },
          { id: 'spec_monodon', title: onboardingT('btn_tiger', lang) }
        ]
      },
      {
        title: onboardingT('btn_fish', lang),
        rows: [
          { id: 'spec_tilapia', title: onboardingT('btn_tilapia', lang) },
          { id: 'spec_rohu', title: onboardingT('btn_rohu', lang) },
          { id: 'spec_pangasius', title: onboardingT('btn_pangasius', lang) },
          { id: 'spec_catfish', title: onboardingT('btn_catfish', lang) },
          { id: 'spec_seabass', title: onboardingT('btn_seabass', lang) },
          { id: 'spec_murrel', title: onboardingT('btn_murrel', lang) },
          { id: 'spec_other_fish', title: onboardingT('btn_other_fish', lang) }
        ]
      }
    ]);
  }
}


/**
 * Unified JIT Context Checking Pipeline
 * Checks if Species, Stocking Date, Seed Count, or Pond Size are missing.
 * Prompts sequentially if anything is missing.
 */
async function checkAndRunJITPipeline(phone, farmer, text, pendingAction) {
  const pond = await getFirstPondByFarmer(farmer.id);
  if (!pond) return false;

  const lang = farmer.preferred_language || 'English';

  // 1. Check Species (if placeholder default_*)
  if (['default_shrimp', 'default_fish', 'default_both'].includes(pond.species)) {
    setState(phone, {
      flow: 'awaiting_jit_species',
      pendingAction: pendingAction || { type: 'rag', originalMessage: text },
      farmerId: farmer.id,
      pondId: pond.id
    });
    await askSpeciesJIT(phone, pond.species, lang);
    return true;
  }

  // 2. Check Stocking Date
  if (!pond.stocking_date) {
    setState(phone, {
      flow: 'awaiting_jit_stocking_date',
      pendingAction: pendingAction || { type: 'rag', originalMessage: text },
      farmerId: farmer.id,
      pondId: pond.id
    });
    await sendTextMessage(phone, lang === 'Telugu' ? 'ఖచ్చితమైన సమాధానం కోసం, మీ *స్టాకింగ్ తేదీ* చెప్పండి (ఉదా: 15/05/2024).' : 
             'To answer accurately, I first need your *Stocking Date* (Example: 15/05/2024).');
    return true;
  }

  // 3. Check Seed Count (Stock)
  if (!pond.seed_count) {
    setState(phone, {
      flow: 'awaiting_jit_seed_count',
      pendingAction: pendingAction || { type: 'rag', originalMessage: text },
      farmerId: farmer.id,
      pondId: pond.id
    });
    await sendTextMessage(phone, lang === 'Telugu' ? '🔢 మీ చెరువులో ఎన్ని విత్తనాలు (seeds) వేశారు? (ఉదా: 100000)' : 
             '🔢 How many seeds did you stock in this pond? (Example: 100000)');
    return true;
  }

  // 4. Check Pond Size
  if (!pond.pond_size) {
    setState(phone, {
      flow: 'awaiting_jit_pond_size',
      pendingAction: pendingAction || { type: 'rag', originalMessage: text },
      farmerId: farmer.id,
      pondId: pond.id
    });
    await sendButtonMessage(phone, 
      lang === 'Telugu' ? 'మీ చెరువు పరిమాణం ఎంత?' : 'What is your pond size?',
      [
        { id: 'jit_size_s', title: lang === 'Telugu' ? '1 ఎకరం కంటే తక్కువ' : '<1 acre' },
        { id: 'jit_size_m', title: lang === 'Telugu' ? '1-3 ఎకరాలు' : '1-3 acres' },
        { id: 'jit_size_l', title: lang === 'Telugu' ? '3 ఎకరాల కంటే ఎక్కువ' : '>3 acres' }
      ]
    );
    return true;
  }

  return false;
}

/**
 * Resume the original action after JIT info has been collected
 */
async function resumeOriginalAction(phone, farmer, pending) {
  if (!pending) return;
  const lang = farmer.preferred_language || 'English';

  if (pending.type === 'topic') {
    await handleTextMessage(phone, `prob_${pending.topic}`);
  } else if (pending.type === 'event') {
    await startEventFollowUp(phone, farmer.id, pending.eventType, pending.originalMessage);
  } else if (pending.type === 'rag') {
    await handleTextMessage(phone, pending.originalMessage);
  }
}


// Input limits
const MAX_MESSAGE_LENGTH = 2000;
const processedMessages = new Set(); // Simple in-memory deduplication

/**
 * Basic input sanitization
 */
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  // Remove control characters and limit length
  return text
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove non-printable chars
    .trim();
}


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

    // Deduplication check
    if (processedMessages.has(messageId)) {
      logger.debug(`⏭️ Skipping duplicate message: ${messageId}`);
      return;
    }
    processedMessages.add(messageId);
    // Keep cache small (last 1000 IDs)
    if (processedMessages.size > 1000) {
      const firstItem = processedMessages.values().next().value;
      processedMessages.delete(firstItem);
    }

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
    } else if (messageType === 'audio') {
      // Voice note — transcribe and process
      await handleAudioMessage(phone, message.audio, messageId);
    } else if (['document', 'video', 'sticker', 'location', 'contacts'].includes(messageType)) {
      // User explicitly sent an unsupported media type
      const farmer = await getFarmerByPhone(phone);
      const lang = farmer?.preferred_language || 'English';
      await sendTextMessage(phone, t('msg_unsupported', lang));
    } else {
      // Silently ignore everything else (system, reaction, unknown, unsupported, etc.)
      logger.debug(`Silently ignored message type: ${messageType}`);
    }
  } catch (error) {
    console.error('CRITICAL ERROR IN WEBHOOK:', error);
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
  logger.info(`💬 Text from ${phone}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);


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
    const lang = farmer?.preferred_language || 'English';

    // --- NEW: Handle Feed Plan Count Input ---
    if (flow === 'awaiting_feed_count') {
      const { getFeedPlan, parseUserCount } = require('../services/feedPlan');
      const abw = parseUserCount(text);
      
      if (!abw) {
        await sendTextMessage(phone, lang === 'Telugu' ? 'క్షమించండి, ఆ నంబర్ నాకు అర్థం కాలేదు. దయచేసి మీ రొయ్యల కౌంట్ (ఉదా: 100) తెలియజేయండి.' : 
               'Sorry, I didn\'t catch that number. Please tell me your shrimp count (e.g., 100 count).');
        return;
      }

      const plan = await getFeedPlan(farmer.id, lang, abw);
      if (plan && plan.type === 'success') {
        await sendTextMessage(phone, plan.message);
        clearState(phone);
      } else {
        await sendTextMessage(phone, plan?.message || 'Error calculating plan.');
        clearState(phone);
      }
      return;
    }

    // JIT COLLECTION: Stocking Date
    if (flow === 'awaiting_jit_stocking_date') {
      const dateParts = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (!dateParts) {
        await sendTextMessage(phone, lang === 'Telugu' ? '❌ దయచేసి సరైన తేదీని DD/MM/YYYY ఫార్మాట్‌లో నమోదు చేయండి.' : '❌ Please enter a valid date (DD/MM/YYYY).');
        return;
      }
      let [_, d, m, y] = dateParts;
      if (y.length === 2) y = '20' + y;
      const parsedDate = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
      if (isNaN(parsedDate.getTime()) || parsedDate > new Date()) {
        await sendTextMessage(phone, '❌ Invalid date.');
        return;
      }
      const isoDate = parsedDate.toISOString().split('T')[0];
      const pond = await getFirstPondByFarmer(farmer.id);
      const { updatePond } = require('../models/database');
      await updatePond(pond.id, { stocking_date: isoDate });

      const pending = state.pendingAction;
      clearState(phone);

      const isJIT = await checkAndRunJITPipeline(phone, farmer, pending?.originalMessage || '', pending);
      if (!isJIT) {
        if (pending && pending.type === 'topic' && pending.topic === 'feed_plan') {
          const q = lang === 'Telugu' ? 'మీ రొయ్యల ప్రస్తుత కౌంట్ ఎంత? (ఉదాహరణకు: 100 కౌంట్ లేదా 10 గ్రాములు)' : 
                   'To give you an accurate plan, what is your current shrimp count (e.g., 100 count) or size in grams?';
          setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
          await sendTextMessage(phone, q);
        } else if (pending) {
          await resumeOriginalAction(phone, farmer, pending);
        } else {
          const q = lang === 'Telugu' ? 'బాగుంది! ఇప్పుడు మీ రొయ్యల కౌంట్ లేదా గ్రాములు తెలియజేయండి.' : 'Great! Now, what is your current shrimp count (e.g., 100 count) or size?';
          setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
          await sendTextMessage(phone, q);
        }
      }
      return;
    }

    // JIT COLLECTION: Seed Count
    if (flow === 'awaiting_jit_seed_count') {
      const countVal = parseInt(text.replace(/,/g, '').trim());
      if (isNaN(countVal) || countVal <= 0) {
        await sendTextMessage(phone, lang === 'Telugu' ? '❌ దయచేసి సరైన సంఖ్యను నమోదు చేయండి.' : '❌ Please enter a valid number.');
        return;
      }
      const pond = await getFirstPondByFarmer(farmer.id);
      const { updatePond } = require('../models/database');
      await updatePond(pond.id, { seed_count: countVal });
      
      const pending = state.pendingAction;
      clearState(phone);

      const isJIT = await checkAndRunJITPipeline(phone, farmer, pending?.originalMessage || '', pending);
      if (!isJIT) {
        if (pending && pending.type === 'topic' && pending.topic === 'feed_plan') {
          const q = lang === 'Telugu' ? 'మీ రొయ్యల ప్రస్తుత కౌంట్ ఎంత? (ఉదాహరణకు: 100 కౌంట్ లేదా 10 గ్రాములు)' : 
                   'To give you an accurate plan, what is your current shrimp count (e.g., 100 count) or size in grams?';
          setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
          await sendTextMessage(phone, q);
        } else if (pending) {
          await resumeOriginalAction(phone, farmer, pending);
        } else {
          const q = lang === 'Telugu' ? 'మీ రొయ్యల ప్రస్తుత కౌంట్ ఎంత? (ఉదాహరణకు: 100 కౌంట్ లేదా 10 గ్రాములు)' : 
                   'To give you an accurate plan, what is your current shrimp count (e.g., 100 count) or size in grams?';
          setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
          await sendTextMessage(phone, q);
        }
      }
      return;
    }

    // JIT COLLECTION: Pond Size
    if (flow === 'awaiting_jit_pond_size') {
      let pondSize = null;
      const cleanText = text.toLowerCase();
      if (cleanText.includes('less') || cleanText.includes('<1') || cleanText.includes('size_small') || cleanText.includes('jit_size_s') || cleanText.includes('1 ఎకరం కంటే తక్కువ')) pondSize = 'less_than_1_acre';
      else if (cleanText.includes('1') && cleanText.includes('3') || cleanText.includes('size_medium') || cleanText.includes('jit_size_m') || cleanText.includes('1-3 ఎకరాలు')) pondSize = '1_3_acres';
      else if (cleanText.includes('more') || cleanText.includes('>3') || cleanText.includes('size_large') || cleanText.includes('jit_size_l') || cleanText.includes('3 ఎకరాల కంటే ఎక్కువ')) pondSize = 'more_than_3_acres';

      if (!pondSize) {
        await sendTextMessage(phone, 'Please select a size: <1 acre, 1-3 acres, or >3 acres.');
        return;
      }
      const pond = await getFirstPondByFarmer(farmer.id);
      const { updatePond } = require('../models/database');
      await updatePond(pond.id, { pond_size: pondSize });
      
      const pending = state.pendingAction;
      clearState(phone);

      const isJIT = await checkAndRunJITPipeline(phone, farmer, pending?.originalMessage || '', pending);
      if (!isJIT) {
        if (pending && pending.type === 'topic' && (pending.topic === 'water' || pending.topic === 'water_quality')) {
          const { deliverImmediateValue } = require('../services/immediateValue');
          await deliverImmediateValue(phone, farmer.id, farmer.village, 'water', lang);
        } else if (pending) {
          await resumeOriginalAction(phone, farmer, pending);
        } else {
          const { deliverImmediateValue } = require('../services/immediateValue');
          await deliverImmediateValue(phone, farmer.id, farmer.village, 'water', lang);
        }
      }
      return;
    }

    // JIT COLLECTION: Specific Species
    if (flow === 'awaiting_jit_species') {
      const inputId = text.trim();
      let selectedSpecies = null;
      if (inputId === 'spec_vannamei') selectedSpecies = 'vannamei';
      else if (inputId === 'spec_monodon') selectedSpecies = 'monodon';
      else if (inputId === 'spec_tilapia') selectedSpecies = 'tilapia';
      else if (inputId === 'spec_rohu') selectedSpecies = 'rohu';
      else if (inputId === 'spec_pangasius') selectedSpecies = 'pangasius';
      else if (inputId === 'spec_catfish') selectedSpecies = 'catfish';
      else if (inputId === 'spec_seabass') selectedSpecies = 'seabass';
      else if (inputId === 'spec_murrel') selectedSpecies = 'murrel';
      else if (inputId === 'spec_other_fish') selectedSpecies = 'other_fish';

      // Fallback text parsing
      if (!selectedSpecies) {
        const lowerInput = inputId.toLowerCase();
        if (lowerInput.includes('vannamei')) selectedSpecies = 'vannamei';
        else if (lowerInput.includes('tiger')) selectedSpecies = 'monodon';
        else if (lowerInput.includes('tilapia')) selectedSpecies = 'tilapia';
        else if (lowerInput.includes('rohu') || lowerInput.includes('imc')) selectedSpecies = 'rohu';
        else if (lowerInput.includes('pangasius')) selectedSpecies = 'pangasius';
        else if (lowerInput.includes('catfish')) selectedSpecies = 'catfish';
        else if (lowerInput.includes('seabass') || lowerInput.includes('pandugappa')) selectedSpecies = 'seabass';
        else if (lowerInput.includes('murrel') || lowerInput.includes('korrameenu')) selectedSpecies = 'murrel';
        else if (lowerInput.includes('other')) selectedSpecies = 'other_fish';
      }

      if (!selectedSpecies) {
        const pond = await getFirstPondByFarmer(farmer.id);
        const lang = farmer.preferred_language || 'English';
        await askSpeciesJIT(phone, pond ? pond.species : 'default_shrimp', lang);
        return;
      }

      const { updatePond } = require('../models/database');
      await updatePond(state.pondId, { species: selectedSpecies });

      const pending = state.pendingAction;
      clearState(phone);

      if (pending) {
        const isJIT = await checkAndRunJITPipeline(phone, farmer, pending.originalMessage || '', pending);
        if (!isJIT) {
          await resumeOriginalAction(phone, farmer, pending);
        }
      }
      return;
    }

    // JIT COLLECTION: Village (Location)
    if (flow === 'awaiting_jit_village') {
      const villageInput = text.trim();
      const lang = farmer.preferred_language || 'English';

      if (villageInput.length < 2) {
        const promptMsg = lang === 'Telugu' ? '❌ దయచేసి సరైన గ్రామం లేదా పట్టణం పేరు నమోదు చేయండి.' :
                          (lang === 'Hindi' ? '❌ कृपया एक वैध गाँव या शहर का नाम दर्ज करें।' :
                          '❌ Please enter a valid village or town name.');
        await sendTextMessage(phone, promptMsg);
        return;
      }

      const { updateFarmer } = require('../models/database');
      await updateFarmer(state.farmerId, { village: villageInput });

      clearState(phone);

      const confirmMsg = onboardingT('msg_jit_village_success', lang).replace('{village}', villageInput);
      await sendTextMessage(phone, confirmMsg);
      return;

    }
    // ------------------------------------------



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
    const pond = await getFirstPondByFarmer(farmer.id);
    if (pond && ['default_shrimp', 'default_fish', 'default_both'].includes(pond.species)) {
      setState(phone, {
        flow: 'awaiting_jit_species',
        pendingAction: {
          type: 'topic',
          topic: topic
        },
        farmerId: farmer.id,
        pondId: pond.id
      });
      const lang = farmer.preferred_language || 'English';
      await askSpeciesJIT(phone, pond.species, lang);
      return;
    }

    
    // NEW: Handle Feed Plan specifically with JIT check
    if (topic === 'feed_plan') {
      const lang = farmer.preferred_language || 'English';
      const pond = await getFirstPondByFarmer(farmer.id);
      
      // 1. Check Stocking Date first
      if (!pond.stocking_date) {
        setState(phone, { flow: 'awaiting_jit_stocking_date', farmerId: farmer.id });
        await sendTextMessage(phone, lang === 'Telugu' ? 'ఖచ్చితమైన మేత ప్రణాళిక కోసం, మీ *స్టాకింగ్ తేదీ* చెప్పండి (ఉదా: 15/05/2024).' : 
                 'To calculate a precise plan, I first need your *Stocking Date* (Example: 15/05/2024).');
        return;
      }

      // 2. Check Seed/Stock Count
      if (!pond.seed_count) {
        setState(phone, { flow: 'awaiting_jit_seed_count', farmerId: farmer.id });
        await sendTextMessage(phone, lang === 'Telugu' ? '🔢 మీ చెరువులో ఎన్ని విత్తనాలు (seeds) వేశారు? (ఉదా: 100000)' : 
                 '🔢 How many seeds did you stock in this pond? (Example: 100000)');
        return;
      }

      // 3. Then check Count
      const q = lang === 'Telugu' ? 'మీ రొయ్యల ప్రస్తుత కౌంట్ ఎంత? (ఉదాహరణకు: 100 కౌంట్ లేదా 10 గ్రాములు)' : 
               (lang === 'Hindi' ? 'आपका झींगा काउंट कितना है? (उदाहरण: 100 काउंट या 10 ग्राम)' : 
               'To give you an accurate plan, what is your current shrimp count (e.g., 100 count) or size in grams?');
      
      setState(phone, { flow: 'awaiting_feed_count', farmerId: farmer.id });
      await sendTextMessage(phone, q);
      return;
    }

    // NEW: Handle Water Quality with JIT Pond Size check
    if (topic === 'water' || topic === 'water_quality') {
      const lang = farmer.preferred_language || 'English';
      const pond = await getFirstPondByFarmer(farmer.id);

      if (!pond.pond_size) {
        setState(phone, { flow: 'awaiting_jit_pond_size', farmerId: farmer.id });
        await sendButtonMessage(phone, 
          lang === 'Telugu' ? 'మీ చెరువు పరిమాణం ఎంత?' : 'What is your pond size?',
          [
            { id: 'jit_size_s', title: lang === 'Telugu' ? '1 ఎకరం కంటే తక్కువ' : '<1 acre' },
            { id: 'jit_size_m', title: lang === 'Telugu' ? '1-3 ఎకరాలు' : '1-3 acres' },
            { id: 'jit_size_l', title: lang === 'Telugu' ? '3 ఎకరాల కంటే ఎక్కువ' : '>3 acres' }
          ]
        );
        return;
      }
      // If already has size, proceed to event follow-up or tips
      await startEventFollowUp(phone, farmer.id, 'water_quality');
      return;
    }


    if (['disease', 'mortality', 'slow_growth', 'growth', 'feed'].includes(topic)) {


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

  // 5.5 Detect feed plan calculation requests
  const feedPlanKeywords = ['feed calculation', 'feed calculator', 'how much feed', 'feed amount', 'feed plan', 'feeding schedule', 'feed table', 'feed entha', 'feed limit', 'మేత ఎంత', 'మేత ఎంత వేయాలి', 'మేత ఎంత ఇవ్వాలి', 'चारा कितना', 'feed count', 'feed size'];
  const isFeedQuery = feedPlanKeywords.some(kw => normalizedText.includes(kw)) || ['feed', 'feeding', 'మేత', 'चारा'].includes(normalizedText);
  if (isFeedQuery) {
    await handleTextMessage(phone, 'prob_feed_plan');
    return;
  }

  // 6. Detect event-based problems from message content
  const eventType = detectEventType(text);
  if (eventType) {
    const pond = await getFirstPondByFarmer(farmer.id);
    if (pond && ['default_shrimp', 'default_fish', 'default_both'].includes(pond.species)) {
      setState(phone, {
        flow: 'awaiting_jit_species',
        pendingAction: {
          type: 'event',
          eventType: eventType,
          originalMessage: text
        },
        farmerId: farmer.id,
        pondId: pond.id
      });
      const lang = farmer.preferred_language || 'English';
      await askSpeciesJIT(phone, pond.species, lang);
      return;
    }
    await startEventFollowUp(phone, farmer.id, eventType, text);
    return;
  }


  // 7. Default: AI Q&A (RAG)
  // Check JIT pipeline before routing to general AI Q&A
  const isJIT = await checkAndRunJITPipeline(phone, farmer, text, { type: 'rag', originalMessage: text });
  if (isJIT) return;

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
    const analysisText = analysis.text;
    const analysisMetadata = analysis.metadata;

    let chatRecordId = null;
    try {
      const chatRecord = await saveChatHistory({
        farmer_id: farmer.id,
        message: '[Image uploaded for disease detection]',
        response: analysisText,
        message_type: 'image',
        ml_metadata: analysisMetadata
      });
      chatRecordId = chatRecord?.id;
    } catch (err) {
      logger.warn('Could not save image chat history initially', { error: err.message });
    }

    // Send the response immediately to avoid latency
    await sendTextMessage(phone, `${t('msg_img_analysis_header', lang)}${analysisText}`);

    // Asynchronously upload image to S3 and update the database with the URL
    setImmediate(async () => {
      try {
        const mimeType = imageData.mime_type || 'image/jpeg';
        const ext = mimeType.split('/')[1] || 'jpg';
        const filename = `farmer_${farmer.id}_${Date.now()}.${ext}`;
        
        // Pass the metadata directly to the storage service for S3 Object Tagging/Metadata
        const mediaUrl = await uploadMedia(imageBuffer, filename, mimeType, analysisMetadata);
        
        if (chatRecordId) {
          await updateChatHistory(chatRecordId, { media_url: mediaUrl });
          logger.info(`✅ Successfully linked S3 URL to chat record ${chatRecordId}`);
        }
      } catch (uploadError) {
        logger.error('Background image upload failed', { error: uploadError.message });
      }
    });

  } catch (error) {
    logger.error('Image analysis failed', { error: error.message, phone });
    await sendTextMessage(phone, t('msg_img_fail', lang));
  }
}

/**
 * Handle audio (voice note) messages
 * Flow: Download → STT (Sarvam) → Route as text → Capture response → TTS (Sarvam) → Send audio
 */
async function handleAudioMessage(phone, audioData, messageId) {
  logger.info(`🎤 Voice note from ${phone}`);

  const farmer = await getFarmerByPhone(phone);
  const lang = farmer?.preferred_language || 'English';

  // Must be onboarded to use voice
  if (!farmer || !farmer.onboarding_complete) {
    await sendTextMessage(phone, t('msg_setup_first', lang));
    return;
  }

  try {
    let activeLang = lang;

    // Step 1: Download audio from WhatsApp
    const audioBuffer = await downloadMedia(audioData.id);
    const mimeType = audioData.mime_type || 'audio/ogg';
    logger.info(`📥 Audio downloaded: ${audioBuffer.length} bytes (${mimeType})`);

    // Cost optimization: skip tiny clips (accidental taps)
    if (audioBuffer.length < MIN_AUDIO_SIZE_BYTES) {
      await sendTextMessage(phone, t('msg_audio_too_short', lang));
      return;
    }

    // Step 2: Send processing indicator
    await sendTextMessage(phone, t('msg_audio_processing', lang));

    // Step 3: Transcribe via Sarvam STT
    const sttResult = await transcribeAudio(audioBuffer, mimeType, lang, audioData.id);

    if (sttResult.skipped || !sttResult.transcript || sttResult.transcript.trim() === '') {
      await sendTextMessage(phone, t('msg_audio_not_understood', lang));
      return;
    }

    const transcript = sttResult.transcript.trim();
    logger.info(`📝 Transcribed: "${transcript.substring(0, 100)}"`);

    // Dynamic language detection & swap based on STT result
    if (sttResult.languageCode) {
      const code = sttResult.languageCode.toLowerCase();
      let newLang = null;
      if (code.startsWith('te')) newLang = 'Telugu';
      else if (code.startsWith('hi')) newLang = 'Hindi';
      else if (code.startsWith('en')) newLang = 'English';

      if (newLang && newLang !== farmer.preferred_language) {
        logger.info(`🔄 Swapping farmer language from ${farmer.preferred_language} to ${newLang} based on detected voice input`);
        await updateFarmer(farmer.id, { preferred_language: newLang });
        activeLang = newLang;
      }
    }

    // Step 4: Capture the bot's text response via eventBus
    // We listen for the next 'message' event targeted at this phone number
    let capturedResponse = null;
    const responsePromise = new Promise((resolve) => {
      const onMessage = ({ to, text }) => {
        if (to === phone) {
          capturedResponse = text;
          eventBus.removeListener('message', onMessage);
          resolve(text);
        }
      };
      eventBus.on('message', onMessage);

      // Timeout after 15s to prevent memory leak
      setTimeout(() => {
        eventBus.removeListener('message', onMessage);
        resolve(null);
      }, 15000);
    });

    // Step 5: Route transcribed text through the existing text pipeline
    await handleTextMessage(phone, transcript);

    // Step 6: Wait for the bot's response to be captured
    const responseText = await responsePromise;

    // Save audio interaction to chat history
    try {
      await saveChatHistory({
        farmer_id: farmer.id,
        message: `[Voice] ${transcript}`,
        response: responseText || '[No text response captured]',
        message_type: 'audio',
      });
    } catch (err) {
      logger.warn('Could not save audio chat history', { error: err.message });
    }

    // Step 7: Generate audio response (with cost optimizations)
    const isErrorResponse = responseText && (
      responseText.includes("trouble right now") || 
      responseText.includes("సమస్య ఎదురైంది") || 
      responseText.includes("समस्या हो रही है")
    );

    if (responseText && shouldGenerateAudio(responseText, 'text') && !isErrorResponse) {
      try {
        const audioResponseBuffer = await textToSpeech(responseText, activeLang);

        if (audioResponseBuffer) {
          // Step 8: Upload to WhatsApp and send
          const mediaId = await uploadMediaToWhatsApp(
            audioResponseBuffer,
            'audio/wav',
            `response_${Date.now()}.wav`
          );
          await sendAudioMessage(phone, mediaId);
          logger.info(`🔊 Audio reply sent to ${phone}`);
        }
      } catch (ttsError) {
        // TTS failure is non-critical — text response was already sent
        logger.error('TTS/audio reply failed (non-critical)', { error: ttsError.message });
      }
    } else {
      logger.info(`⏭️ Skipped audio reply — shouldGenerateAudio=false`);
    }

  } catch (error) {
    logger.error('Audio processing failed', { error: error.message, phone });
    await sendTextMessage(phone, t('msg_audio_fail', activeLang));
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
    msg_unsupported: 'I can understand text messages, voice notes, and images. 📝🎤📸\n\nPlease send a text question, voice message, or a photo for disease detection.',
    msg_audio_processing: '🎤 Processing your voice message...',
    msg_audio_too_short: '🎤 Your voice message was too short. Please try again with a longer message.',
    msg_audio_not_understood: '🎤 Sorry, I couldn\'t understand your voice message. Please try again or type your question.',
    msg_audio_fail: '⚠️ Sorry, I couldn\'t process your voice message right now. Please try typing your question instead.',
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
    msg_unsupported: 'నేను టెక్స్ట్ సందేశాలు, వాయిస్ నోట్‌లు మరియు చిత్రాలను అర్థం చేసుకోగలను. 📝🎤📸\n\nదయచేసి ప్రశ్న, వాయిస్ మెసేజ్ లేదా వ్యాధి గుర్తింపు కోసం ఫోటోను పంపండి.',
    msg_audio_processing: '🎤 మీ వాయిస్ మెసేజ్‌ను ప్రాసెస్ చేస్తున్నాను...',
    msg_audio_too_short: '🎤 మీ వాయిస్ మెసేజ్ చాలా చిన్నగా ఉంది. దయచేసి పొడవైన మెసేజ్‌తో మళ్ళీ ప్రయత్నించండి.',
    msg_audio_not_understood: '🎤 క్షమించండి, మీ వాయిస్ మెసేజ్ అర్థం కాలేదు. దయచేసి మళ్ళీ ప్రయత్నించండి లేదా మీ ప్రశ్నను టైప్ చేయండి.',
    msg_audio_fail: '⚠️ క్షమించండి, మీ వాయిస్ మెసేజ్‌ను ప్రాసెస్ చేయడం సాధ్యం కాలేదు. దయచేసి మీ ప్రశ్నను టైప్ చేయండి.',
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
    msg_unsupported: 'मैं टेक्स्ट संदेश, वॉइस नोट्स और छवियों को समझ सकता हूँ। 📝🎤📸\n\nकृपया प्रश्न, वॉइस मैसेज या रोग की पहचान के लिए फोटो भेजें।',
    msg_audio_processing: '🎤 आपके वॉइस मैसेज को प्रोसेस कर रहा हूँ...',
    msg_audio_too_short: '🎤 आपका वॉइस मैसेज बहुत छोटा था। कृपया लंबे मैसेज के साथ पुनः प्रयास करें।',
    msg_audio_not_understood: '🎤 क्षमा करें, मैं आपका वॉइस मैसेज समझ नहीं पाया। कृपया पुनः प्रयास करें या अपना प्रश्न टाइप करें।',
    msg_audio_fail: '⚠️ क्षमा करें, आपके वॉइस मैसेज को प्रोसेस नहीं कर सका। कृपया अपना प्रश्न टाइप करें।',
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
