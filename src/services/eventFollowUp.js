const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { answerQuestion } = require('./ai');
const productEngine = require('./productEngine');
const { findRecentAnswer } = require('../utils/contextHelper');
const intelligence = require('./intelligence');



/**
 * Event-Based Follow-Up
 *
 * 
 * Triggered ONLY when the farmer reports a problem (we never ask first).
 * Dynamic question trees based on the problem type.
 *
 * Supported events:
 *  - mortality: "How many died?", "Since when?", "Red body/white spots?", etc.
 *  - slow_growth: "Feed?", "Pond color?", "White gut?", "Water test?"
 *  - disease: "What symptoms?", "How many affected?", "When started?"
 */

// ========================
// EVENT TREES
// ========================

const EVENT_TREES = {
  mortality: {
    label: (lang) => t('label_mortality', lang),
    steps: [
      {
        key: 'how_many',
        prompt: (lang) => t('q_mort_find_dead', lang),
        buttons: (lang) => [
          { id: 'mort_1_50', title: t('btn_mort_1_50', lang) },
          { id: 'mort_50_100', title: t('btn_mort_50_100', lang) },
          { id: 'mort_100plus', title: t('btn_mort_100plus', lang) },
        ],
        parseButton: (input) => {
          if (input === 'mort_1_50' || input.includes('1-50')) return '1-50';
          if (input === 'mort_50_100' || input.includes('50-100')) return '50-100';
          if (input === 'mort_100plus' || input.includes('100+')) return '100+';
          return null;
        },
      },
      {
        key: 'since_when',
        prompt: (lang) => t('q_since_when', lang),
        buttons: (lang) => [
          { id: 'mort_today', title: t('btn_today', lang) },
          { id: 'mort_yesterday', title: t('btn_yesterday', lang) },
          { id: 'mort_days', title: t('btn_2_3_days', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('today') || input === 'mort_today') return 'today';
          if (input.includes('yesterday') || input === 'mort_yesterday') return 'yesterday';
          if (input.includes('2') || input.includes('3') || input.includes('day') || input === 'mort_days') return '2-3_days';
          if (input.includes('week') || input === 'mort_week') return 'this_week';
          return null;
        },
      },
      {
        key: 'body_signs',
        prompt: (lang) => t('q_body_signs_mort', lang),
        type: 'list',
        listButtonLabel: (lang) => t('btn_select_symptoms', lang),
        listSections: (lang, species) => {
          const isFish = isFishSpecies(species);
          if (isFish) {
            return [{
              title: t('label_fish_symptoms', lang),
              rows: [
                { id: 'mort_sign_sores', title: t('sym_red_ulcer', lang) },
                { id: 'mort_sign_dropsy', title: t('sym_dropsy', lang) },
                { id: 'mort_sign_rot', title: t('sym_fin_rot', lang) },
                { id: 'mort_sign_parasite', title: t('sym_argulus', lang) },
                { id: 'mort_sign_gasping', title: t('sym_gasping', lang) },
                { id: 'mort_sign_other', title: t('sym_other', lang) },
                { id: 'mort_sign_none', title: t('sym_no_signs', lang) }
              ]
            }];
          } else {
            return [{
              title: t('label_shrimp_symptoms', lang),
              rows: [
                { id: 'mort_sign_white', title: t('sym_white_spots', lang) },
                { id: 'mort_sign_gut', title: t('sym_white_gut', lang) },
                { id: 'mort_sign_red', title: t('sym_red_body', lang) },
                { id: 'mort_sign_gills', title: t('sym_black_gills', lang) },
                { id: 'mort_sign_cramp', title: t('sym_muscle_cramps', lang) },
                { id: 'mort_sign_other', title: t('sym_other', lang) },
                { id: 'mort_sign_none', title: t('sym_no_signs', lang) }
              ]
            }];
          }
        },
        parseButton: (input) => {
          if (input === 'no' || input.includes('no sign') || input === 'mort_sign_none') return 'none';
          if (input.includes('white spot') || input === 'mort_sign_white') return 'white_spots';
          if (input.includes('red') || input.includes('sores') || input === 'mort_sign_red' || input === 'mort_sign_sores') return 'red_body_sores';
          if (input.includes('gut') || input === 'mort_sign_gut') return 'white_gut';
          if (input.includes('gills') || input === 'mort_sign_gills') return 'black_gills';
          if (input.includes('cramp') || input === 'mort_sign_cramp') return 'muscle_cramps';
          if (input.includes('dropsy') || input === 'mort_sign_dropsy') return 'dropsy';
          if (input.includes('fin') || input.includes('rot') || input === 'mort_sign_rot') return 'fin_tail_rot';
          if (input.includes('lice') || input.includes('argulus') || input === 'mort_sign_parasite') return 'parasites';
          if (input.includes('gasping') || input === 'mort_sign_gasping') return 'gasping';
          if (input.includes('other') || input === 'mort_sign_other') return 'other';
          return null;
        },
      },
    ],

  },

  slow_growth: {
    label: (lang) => t('label_slow_growth', lang),
    steps: [
      {
        key: 'feed_type',
        prompt: (lang) => t('q_feed_using', lang),
        type: 'text',
        validate: (v) => v && v.trim().length >= 2,
        errorMsg: (lang) => t('err_feed_name', lang),
      },
      {
        key: 'pond_color',
        prompt: (lang) => t('q_pond_color', lang),
        buttons: (lang) => [
          { id: 'sg_dark', title: t('btn_green_dark', lang) },
          { id: 'sg_brown', title: t('btn_brown_black', lang) },
          { id: 'cancel_flow', title: t('btn_cancel', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('cancel') || input === 'cancel_flow') return 'cancel';
          if (input.includes('green') || input === 'sg_green') return 'green';
          if (input.includes('brown') || input.includes('black') || input === 'sg_brown') return 'brown_black';
          return null;
        },
      },
      {
        key: 'white_gut',
        prompt: (lang) => t('q_white_gut_signs', lang),
        buttons: (lang) => [
          { id: 'sg_gut_no', title: t('btn_no', lang) },
          { id: 'sg_gut_yes', title: t('btn_yes', lang) },
          { id: 'sg_gut_unsure', title: t('btn_not_sure', lang) },
        ],
        parseButton: (input) => {
          if (input === 'no' || input === 'sg_gut_no') return 'no';
          if (input === 'yes' || input === 'sg_gut_yes') return 'yes';
          if (input.includes('not sure') || input === 'sg_gut_unsure') return 'not_sure';
          return null;
        },
      },
    ],
  },

  disease: {
    label: (lang) => t('label_disease', lang),
    steps: [
      {
        key: 'symptoms',
        prompt: (lang) => t('q_symptoms', lang),
        type: 'list',
        listButtonLabel: (lang) => t('btn_select_symptoms', lang),
        listSections: (lang, species) => {
          const isFish = isFishSpecies(species);
          if (isFish) {
            return [{
              title: t('label_fish_symptoms', lang),
              rows: [
                { id: 'dis_sores', title: t('sym_red_ulcer', lang) },
                { id: 'disease_dropsy', title: t('sym_dropsy', lang) },
                { id: 'dis_rot', title: t('sym_fin_rot', lang) },
                { id: 'dis_parasite', title: t('sym_argulus', lang) },
                { id: 'disease_gasping', title: t('sym_gasping', lang) },
                { id: 'dis_other', title: t('sym_other', lang) },
                { id: 'cancel_flow', title: t('btn_cancel', lang) }
              ]
            }];
          } else {
            return [{
              title: t('label_shrimp_symptoms', lang),
              rows: [
                { id: 'dis_spots', title: t('sym_white_spots', lang) },
                { id: 'disease_white_gut', title: t('sym_white_gut', lang) },
                { id: 'dis_red_other', title: t('sym_red_body', lang) },
                { id: 'disease_black_gills', title: t('sym_black_gills', lang) },
                { id: 'disease_muscle_cramps', title: t('sym_muscle_cramps', lang) },
                { id: 'dis_other', title: t('sym_other', lang) },
                { id: 'cancel_flow', title: t('btn_cancel', lang) }
              ]
            }];
          }
        },
        parseButton: (input) => {
          if (input.includes('cancel') || input === 'cancel_flow') return 'cancel';
          if (input.includes('white spot') || input === 'dis_spots') return 'white_spots';
          if (input.includes('red') || input.includes('sores') || input === 'dis_red_other' || input === 'dis_sores') return 'red_body_sores';
          if (input.includes('gut') || input === 'disease_white_gut') return 'white_gut';
          if (input.includes('gills') || input === 'disease_black_gills') return 'black_gills';
          if (input.includes('cramp') || input === 'disease_muscle_cramps') return 'muscle_cramps';
          if (input.includes('dropsy') || input === 'disease_dropsy') return 'dropsy';
          if (input.includes('fin') || input.includes('rot') || input === 'dis_rot') return 'fin_tail_rot';
          if (input.includes('lice') || input.includes('argulus') || input === 'dis_parasite') return 'parasites';
          if (input.includes('gasping') || input === 'disease_gasping') return 'gasping';
          if (input.includes('other') || input === 'dis_other') return 'other';
          return null;
        },
      },
      {
        key: 'how_many_affected',
        prompt: (lang) => t('q_how_many_affected', lang),
        buttons: (lang) => [
          { id: 'dis_few', title: t('btn_a_few', lang) },
          { id: 'dis_many', title: t('btn_many', lang) },
          { id: 'dis_most', title: t('btn_most_all', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('few') || input === 'dis_few') return 'a_few';
          if (input.includes('many') || input === 'dis_many') return 'many';
          if (input.includes('most') || input === 'all' || input === 'dis_most') return 'most';
          return null;
        },
      },
    ],
  },

  water_quality: {
    label: (lang) => t('label_water_check', lang),
    steps: [
      {
        key: 'water_color',
        prompt: (lang) => t('q_current_water_color', lang),
        buttons: (lang) => [
          { id: 'wq_green', title: t('btn_green', lang) },
          { id: 'wq_brown', title: t('btn_brown_black', lang) },
          { id: 'wq_clear', title: t('btn_clear', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('green') || input === 'wq_green') return 'green';
          if (input.includes('brown') || input.includes('black') || input === 'wq_brown') return 'brown_black';
          if (input.includes('clear') || input === 'wq_clear') return 'clear';
          return null;
        },
      },
      {
        key: 'smell_foam',
        prompt: (lang) => t('q_smell_foam', lang),
        buttons: (lang) => [
          { id: 'wq_sf_none', title: t('btn_none', lang) },
          { id: 'wq_sf_smell', title: t('btn_bad_smell', lang) },
          { id: 'wq_sf_foam', title: t('btn_foam_bubbles', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('none') || input === 'wq_sf_none') return 'none';
          if (input.includes('smell') || input === 'wq_sf_smell') return 'bad_smell';
          if (input.includes('foam') || input.includes('bubble') || input === 'wq_sf_foam') return 'foam_bubbles';
          return null;
        },
      },
    ],
  },

  feed: {
    label: (lang) => t('label_feed_assess', lang),
    steps: [
      {
        key: 'feed_status',
        prompt: (lang) => t('q_feed_status', lang),
        buttons: (lang) => [
          { id: 'fd_normal', title: t('btn_normal', lang) },
          { id: 'fd_reduced', title: t('btn_reduced', lang) },
          { id: 'fd_off', title: t('btn_off_feed', lang) },
        ],
        parseButton: (input) => {
          if (input.includes('normal') || input === 'fd_normal') return 'normal';
          if (input.includes('reduced') || input === 'fd_reduced') return 'reduced';
          if (input.includes('off') || input.includes('stop') || input === 'fd_off') return 'off_feed';
          return null;
        },
      },
      {
        key: 'feed_brand',
        prompt: (lang) => t('q_feed_brand_q', lang),
        type: 'text',
        validate: (v) => v && v.trim().length >= 2,
        errorMsg: (lang) => t('err_feed_brand_name', lang),
      },
      {
        key: 'leftovers',
        prompt: (lang) => t('q_leftovers', lang),
        buttons: (lang) => [
          { id: 'fd_lo_none', title: t('btn_no', lang) },
          { id: 'fd_lo_some', title: t('btn_a_little', lang) },
          { id: 'fd_lo_many', title: t('btn_lot_of_feed', lang) },
        ],
        parseButton: (input) => {
          if (input === 'no' || input === 'fd_lo_none') return 'none';
          if (input.includes('little') || input === 'fd_lo_some') return 'little';
          if (input.includes('lot') || input === 'fd_lo_many') return 'lot';
          return null;
        },
      },
    ],
  },
};

/**
 * Helper to identify if a species is a fish or shrimp.
 */
function isFishSpecies(species) {
  if (!species) return false;
  const s = species.toLowerCase();
  const fishKeywords = ['fish', 'tilapia', 'rohu', 'catla', 'mrigal', 'pangasius', 'seabass', 'murrel', 'jalidi', 'pandugappa', 'imc'];
  return fishKeywords.some(k => s.includes(k));
}

// ========================
// START EVENT FOLLOW-UP
// ========================

async function startEventFollowUp(phone, farmerId, eventType, originalMessage = '') {
  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(farmerId);
  const lang = farmer?.preferred_language || 'English';

  const tree = EVENT_TREES[eventType];
  if (!tree) return false;

  const pond = await getFirstPondByFarmer(farmerId);
  const species = pond ? pond.species : 'vannamei';

  setState(phone, {
    flow: 'event_followup',
    step: 0,
    data: {},
    farmerId,
    pondId: pond ? pond.id : null,
    species: species,
    eventType,
    originalMessage,
  });

  const label = typeof tree.label === 'function' ? tree.label(lang) : tree.label;
  
  // Intelligence: Bio-security warning for multi-pond farmers
  let greeting = `📋 *${label}*\n\n${t('greet_event', lang)}`;
  if (eventType === 'disease' || eventType === 'mortality') {
    const bioWarning = await intelligence.getBioSecurityWarning(farmerId, pond?.id, lang);
    if (bioWarning) {
      greeting += `\n\n${bioWarning}`;
    }
  }

  await sendTextMessage(phone, greeting);


  await askEventQuestion(phone);
  return true;
}

// ========================
// HANDLE STEP
// ========================

async function handleEventStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'event_followup') return false;

  const tree = EVENT_TREES[state.eventType];
  if (!tree) return false;

  const stepIndex = state.step;
  if (stepIndex >= tree.steps.length) return false;

  const stepDef = tree.steps[stepIndex];
  const input = message.toLowerCase().trim();

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  // Handle free text step
  if (stepDef.type === 'text') {
    if (!stepDef.validate(message)) {
      const errorMsg = typeof stepDef.errorMsg === 'function' ? stepDef.errorMsg(lang) : stepDef.errorMsg;
      await sendTextMessage(phone, errorMsg);
      return true;
    }
    updateStateData(phone, { [stepDef.key]: message.trim() });
  } else {
    const value = stepDef.parseButton(input);
    
    // Check for explicit cancel or exit keyword
    if (value === 'cancel' || ['stop', 'exit', 'cancel', 'menu', 'hi', 'hii', 'hello'].includes(input)) {
      clearState(phone);
      await sendTextMessage(phone, t('msg_cancelled', lang));
      return true;
    }

    if (!value) {
      // Logic to prevent infinite loops: allow 2 attempts
      const attempts = (state.attempts || 0) + 1;
      if (attempts >= 2) {
        clearState(phone);
        await sendTextMessage(phone, t('msg_not_understood', lang));
        return true;
      }
      updateStateData(phone, { attempts });
      await askEventQuestion(phone);
      return true;
    }
    updateStateData(phone, { [stepDef.key]: value, attempts: 0 }); // reset attempts on success
  }

  const updatedState = getState(phone);
  if (updatedState.step >= tree.steps.length) {
    await finalizeEvent(phone);
    return true;
  }

  await askEventQuestion(phone);
  return true;
}

// ========================
// ASK QUESTION
// ========================

async function askEventQuestion(phone) {
  const state = getState(phone);
  const tree = EVENT_TREES[state.eventType];
  const stepIndex = state.step;

  if (stepIndex >= tree.steps.length) {
    await finalizeEvent(phone);
    return;
  }

  const stepDef = { ...tree.steps[stepIndex] };
  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  // --- SMART SKIP LOGIC ---
  // Check if we already have this answer recently (last 24h)
  const recentValue = await findRecentAnswer(state.pondId, stepDef.key);
  
  if (recentValue && !state.attempts) {
    console.log(`🧠 Smart Skip: Found recent value for ${stepDef.key} -> ${recentValue}`);
    
    // Save the data and move to next step automatically
    updateStateData(phone, { 
      [stepDef.key]: recentValue,
      step: state.step + 1
    });

    // Notify user of the skip to maintain context
    let skipMsg = `✅ I already have your ${stepDef.key.replace(/_/g, ' ')} from earlier today: *${recentValue}*`;
    if (lang === 'Telugu') skipMsg = `✅ ఈరోజు మీ ${stepDef.key.replace(/_/g, ' ')} గురించి నాకు ఇప్పటికే సమాచారం ఉంది: *${recentValue}*`;
    if (lang === 'Hindi') skipMsg = `✅ मेरे पास आज का आपका ${stepDef.key.replace(/_/g, ' ')} पहले से है: *${recentValue}*`;
    
    await sendTextMessage(phone, skipMsg);

    // Recursively call to check next question
    return askEventQuestion(phone);
  }
  // -------------------------

  const prompt = typeof stepDef.prompt === 'function' ? stepDef.prompt(lang, state.species) : stepDef.prompt;

  if (stepDef.type === 'text') {
    await sendTextMessage(phone, prompt);
  } else if (stepDef.type === 'list') {
    const sections = stepDef.listSections(lang, state.species);
    const listButtonLabel = typeof stepDef.listButtonLabel === 'function' ? stepDef.listButtonLabel(lang) : stepDef.listButtonLabel;
    await sendListMessage(phone, prompt, listButtonLabel || 'Select Option', sections);
  } else {
    const buttons = typeof stepDef.buttons === 'function' ? stepDef.buttons(lang, state.species) : stepDef.buttons;
    await sendButtonMessage(phone, prompt, buttons);
  }
}


// ========================
// FINALIZE — Send collected data to AI for diagnosis
// ========================

async function finalizeEvent(phone) {
  const state = getState(phone);
  const data = state.data;
  const tree = EVENT_TREES[state.eventType];
  const { scheduleFollowUp, getPondById } = require('../models/database');

  // Save to pond_logs

  if (state.pondId) {
    try {
      await insertPondLog({
        pond_id: state.pondId,
        log_group: 'event',
        log_data: { event_type: state.eventType, ...data },
      });
    } catch (err) {
      console.warn('⚠️ Could not save event log:', err.message);
    }
  }

  // Schedule follow-up
  if (state.pondId) {
    try {
      let daysToAdd = 1; // Default to 1 day for mortality and disease
      if (state.eventType === 'slow_growth') {
        daysToAdd = 2;
      }
      
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + daysToAdd);
      const dateStr = followUpDate.toISOString().split('T')[0];
      
      await scheduleFollowUp(state.farmerId, state.pondId, state.eventType, dateStr);
      console.log(`📅 Scheduled proactive follow-up for ${state.eventType} on ${dateStr}`);
    } catch (err) {
      console.warn('⚠️ Could not schedule follow-up:', err.message);
    }
  }

  // Build context for AI
  let context = `The farmer is reporting a problem: ${tree.label}\n\n`;
  
  // Include original message if available
  if (state.originalMessage) {
    context += `Original farmer message: "${state.originalMessage}"\n\n`;
  }
  
  context += `Collected information:\n`;
  for (const [key, value] of Object.entries(data)) {
    context += `- ${key.replace(/_/g, ' ')}: ${value}\n`;
  }
  context += `\nBased on this information, provide:\n`;
  context += `1. What this most likely indicates\n`;
  context += `2. Immediate actions to take (2-3 steps)\n`;
  context += `3. Whether they should consult an expert\n\n`;

  // --- NEW: Recommendation Engine Integration ---
  let recommendedProductSection = "";
  try {
    const pond = await getPondById(state.pondId);
    const pondSizeValue = productEngine.getPondSizeValue(pond?.pond_size);
    
    let problemKey = null;
    if (state.eventType === 'mortality' && data.body_signs === 'white_spots') problemKey = 'wssv_emergency';
    else if (data.body_signs === 'white_feces_strings' || data.symptoms === 'white_feces_strings') problemKey = 'white_feces';
    else if (data.body_signs === 'pale_hp_ems' || data.symptoms === 'pale_hp_ems') problemKey = 'ems_emergency';
    else if (data.body_signs === 'red_body_sores' || data.symptoms === 'red_body_sores') problemKey = 'eus_emergency';
    else if (data.body_signs === 'parasites' || data.symptoms === 'parasites') problemKey = 'fish_parasites';
    else if (data.symptoms === 'fin_tail_rot') problemKey = 'fish_bacterial';
    else if (state.eventType === 'disease') problemKey = 'disease_bacterial';
    else if (state.eventType === 'slow_growth') problemKey = 'slow_growth';
    else if (data.water_smell === 'yes') problemKey = 'high_organic_load';

    if (problemKey) {
      const rec = productEngine.getRecommendation(problemKey, { pondSizeValue });
      if (rec) {
        recommendedProductSection = productEngine.formatRecommendation(rec);
        context += `\n## STRONGLY RECOMMENDED PRODUCT:\n`;
        context += `- Product: ${rec.product}\n`;
        context += `- Dosage: ${rec.dosage}\n`;
        context += `- Steps: ${rec.steps.join(', ')}\n`;
        context += `Incorporate this recommendation into your Action section.\n`;
      }
    }
  } catch (err) {
    console.warn('⚠️ Recommendation mapping failed in event flow:', err.message);
  }

  context += `Keep it concise (max 150 words), practical, and formatted for WhatsApp.`;

  clearState(phone);

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  // Send thinking message
  await sendTextMessage(phone, t('msg_analyzing', lang));

  // Get AI diagnosis
  try {
    const diagnosis = await answerQuestion(context, state.farmerId);
    
    // Save event + diagnosis to chat history
    try {
      await saveChatHistory({
        farmer_id: state.farmerId,
        message: `[Event: ${tree.label}] ${state.originalMessage || ''} | Data: ${JSON.stringify(data)}`,
        response: diagnosis,
        message_type: 'event',
      });
    } catch (chatErr) {
      console.warn('⚠️ Could not save event to chat history:', chatErr.message);
    }
    
    const label = typeof tree.label === 'function' ? tree.label(lang) : tree.label;
    let finalMsg = `📋 *${label} — Assessment*\n\n${diagnosis}${recommendedProductSection ? '\n\n' + recommendedProductSection : ''}`;
    
    // Intelligence: Check for anomalies (jumps in mortality)
    const anomalyAlert = await intelligence.checkAnomalies(state.pondId, data, 'event', lang);
    if (anomalyAlert) {
      finalMsg += `\n\n⚠️ *Alert:* ${anomalyAlert}`;
    }

    await sendTextMessage(phone, finalMsg);

  } catch (err) {
    console.error('❌ Event AI analysis failed:', err.message);
    await sendTextMessage(phone,
      t('msg_ai_fail_advice', lang) + '\n\n' +
      getDefaultEventAdvice(state.eventType, data) +
      `\n\n⚠️ *${t('msg_consult_expert', lang)}*`
    );
  }
}

// ========================
// DEFAULT ADVICE (fallback if AI fails)
// ========================

function getDefaultEventAdvice(eventType, data) {
  if (eventType === 'mortality') {
    let advice = '1. Check water quality immediately (DO, pH, ammonia)\n';
    advice += '2. Increase aeration to maximum\n';
    advice += '3. Reduce or stop feeding for 24 hours\n';
    if (data.body_signs === 'white_spots') advice += '4. 🚨 White spots suggest WSSV — consider emergency harvest\n';
    if (data.body_signs === 'red_body') advice += '4. Red body suggests Vibriosis — apply probiotics\n';
    return advice;
  }
  if (eventType === 'slow_growth') {
    let advice = '1. Check feed quality and ensure proper feeding rate\n';
    advice += '2. Monitor water quality (DO > 5, pH 7.5-8.5)\n';
    advice += '3. Check for parasites or disease signs\n';
    if (data.white_gut === 'yes') advice += '4. White gut may indicate EHP — reduce feed by 30-50%\n';
    return advice;
  }
  if (eventType === 'disease') {
    let advice = '1. Isolate affected animals if possible\n';
    advice += '2. Maintain water quality and increase aeration\n';
    advice += '3. Send a photo for better analysis\n';
    return advice;
  }
  return '1. Monitor closely\n2. Maintain water quality\n3. Consult an expert';
}

/**
 * Detect if a message indicates a problem event
 * Returns the event type or null
 */
function detectEventType(text) {
  const lower = text.toLowerCase().trim();

  // 1. AVOID TRIGGERING ON KNOWLEDGE QUESTIONS
  // Multilingual "what is" markers
  const knowledgeMarkers = [
    'what is', 'how to', 'why', 'explain', 'tell me', 'define',
    'ante enti', 'ela', 'eppudu', // Telugu
    'kya hai', 'kaise', 'kyun'    // Hindi
  ];

  const isQuestion = knowledgeMarkers.some(m => lower.includes(m)) || lower.endsWith('?');
  if (isQuestion) return null;

  // 2. CHECK FOR REPORTING INTENT
  // Keywords must be present, but we also look for "reporting" markers
  // TIGHTENED: We now require words like "have", "seeing", "problem" or "help" to indicate an active issue.
  const reportingMarkers = ['have', 'seeing', 'found', 'problem', 'help', 'is', 'my', 'issue', 'unaru', 'vundi', 'undi', 'hai', 'mil raha hai'];
  const hasReportingMarker = reportingMarkers.some(m => lower.includes(m));

  const hasProblemKeywords = lower.includes('died') || lower.includes('dead') || 
                             lower.includes('mortality') || lower.includes('not growing') || 
                             lower.includes('white spot') || lower.includes('red body') ||
                             lower.includes('sick') || lower.includes('problem');

  if (!hasProblemKeywords || !hasReportingMarker) return null;

  // Specific detection
  if (lower.includes('died') || lower.includes('dead') || lower.includes('mortality') ||
      lower.includes('dying') || lower.includes('death') || lower.includes('lost')) {
    return 'mortality';
  }

  if (lower.includes('slow growth') || lower.includes('not growing') ||
      lower.includes('growing slow') || lower.includes('no growth') ||
      lower.includes('small size') || lower.includes('low weight')) {
    return 'slow_growth';
  }

  if (lower.includes('disease') || lower.includes('white spot') || lower.includes('red body') ||
      lower.includes('white gut') || lower.includes('infection') ||
      lower.includes('sick') || lower.includes('unhealthy')) {
    return 'disease';
  }

  return null;
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    label_mortality: 'Mortality Report',
    q_mort_find_dead: '💀 How many did you find dead?',
    btn_mort_1_50: '1-50',
    btn_mort_50_100: '50-100',
    btn_mort_100plus: '100+',
    btn_cancel: 'Cancel ❌',

    q_since_when: '📅 Since when?',
    btn_today: 'Today',
    btn_yesterday: 'Yesterday',
    btn_2_3_days: '2-3 days',
    q_water_smell: '👃 Any unusual water smell?',
    btn_yes: 'Yes',
    btn_no: 'No',
    q_body_signs_mort: '🔍 Any visible symptoms?',

    q_fish_body_signs: '🔍 Any visible signs on the fish body?',
    btn_no_signs: 'No signs',
    btn_red_body: 'Red body',
    btn_white_spots: 'White spots',
    btn_red_sores: 'Red sores',
    btn_parasites: 'Parasites',
    label_slow_growth: 'Slow Growth Investigation',
    q_feed_using: '🍽️ What feed are you using?',
    err_feed_name: 'Please type the feed brand/type name.',
    q_pond_color: '🎨 What is the pond water color?',
    btn_green_dark: 'Green / Dark',
    btn_brown_black: 'Brown / Black',
    q_white_gut_signs: '🔬 Any white gut/feces signs?',
    btn_not_sure: 'Not sure',
    label_disease: 'Disease Investigation',
    q_symptoms: '🔬 What symptoms do you see?',
    btn_select_symptoms: 'Select Symptoms',
    label_fish_symptoms: 'Fish Symptoms',
    label_shrimp_symptoms: 'Shrimp Symptoms',
    sym_red_ulcer: 'Red spots / Ulcers',
    sym_dropsy: 'Dropsy (Swollen Belly)',
    sym_fin_rot: 'Fin / Tail Rot',
    sym_argulus: 'Fish lice (Argulus)',
    sym_gasping: 'Gasping at surface',
    sym_other: 'Other signs',
    sym_white_spots: 'White spots',
    sym_white_gut: 'White gut',
    sym_red_body: 'Red body',
    sym_black_gills: 'Black gills',
    sym_muscle_cramps: 'Muscle cramps',
    q_how_many_affected: '📊 How many are affected?',
    btn_a_few: 'A few',
    btn_many: 'Many',
    btn_most_all: 'Most/All',
    label_water_check: 'Water Quality Check',
    q_current_water_color: '🎨 What is the current water color?',
    btn_green: 'Green',
    btn_clear: 'Clear',
    q_smell_foam: '🫧 Any bad smell or excessive foam?',
    btn_none: 'None',
    btn_bad_smell: 'Bad smell',
    btn_foam_bubbles: 'Foam/Bubbles',
    label_feed_assess: 'Feed Assessment',
    q_feed_status: '🍽️ How is the feeding status?',
    btn_normal: 'Normal',
    btn_reduced: 'Reduced',
    btn_off_feed: 'Off-feed (Stopped)',
    q_feed_brand_q: '🏷️ Which feed brand are you currently using?',
    err_feed_brand_name: 'Please type the name of the feed brand.',
    q_leftovers: '📊 Any leftover feed in the check tray?',
    btn_a_little: 'A little',
    btn_lot_of_feed: 'Lot of feed',
    greet_event: 'Let me ask a few quick questions so I can help you better.',
    msg_cancelled: '❌ Investigation cancelled. How can I help you otherwise?',
    msg_not_understood: 'I didn\'t quite get that. I\'ve closed the investigation for now so you can chat normally. Type "help" if you need me!',
    msg_analyzing: '🔍 Analyzing your situation...',
    msg_ai_fail_advice: 'Based on what you\'ve described, here are immediate steps:',
    msg_consult_expert: 'Please consult a local aquaculture expert for proper diagnosis.'
  },
  Telugu: {
    label_mortality: 'మరణాల నివేదిక',
    q_mort_find_dead: '💀 మీరు ఎన్ని చనిపోయి ఉండటం గమనించారు?',
    btn_mort_1_50: '1-50',
    btn_mort_50_100: '50-100',
    btn_mort_100plus: '100+',
    btn_cancel: 'రద్దు చేయి ❌',

    q_since_when: '📅 ఎప్పటి నుండి?',
    btn_today: 'ఈరోజు',
    btn_yesterday: 'నిన్న',
    btn_2_3_days: '2-3 రోజులు',
    q_water_smell: '👃 నీటిలో ఏవైనా అసాధారణ వాసనలు ఉన్నాయా?',
    btn_yes: 'అవును',
    btn_no: 'లేదు',
    q_body_signs_mort: '🔍 ఏవైనా లక్షణాలు కనిపిస్తున్నాయా?',

    q_fish_body_signs: '🔍 చేప శరీరంపై ఏవైనా స్పష్టమైన లక్షణాలు ఉన్నాయా?',
    btn_no_signs: 'లక్షణాలు లేవు',
    btn_red_body: 'ఎర్రటి శరీరం',
    btn_white_spots: 'తెల్ల మచ్చలు',
    btn_red_sores: 'ఎర్రటి పుండ్లు',
    btn_parasites: 'పరాన్నజీవులు',
    label_slow_growth: 'నెమ్మదిగా పెరుగుదల విచారణ',
    q_feed_using: '🍽️ మీరు ఏ మేతను ఉపయోగిస్తున్నారు?',
    err_feed_name: 'దయచేసి మేత బ్రాండ్/రకం పేరును టైప్ చేయండి.',
    q_pond_color: '🎨 చెరువు నీటి రంగు ఏమిటి?',
    btn_green_dark: 'ఆకుపచ్చ / ముదురు',
    btn_brown_black: 'గోధుమ / నలుపు',
    q_white_gut_signs: '🔬 ఏదైనా తెల్లటి పేగు/విసర్జన లక్షణాలు ఉన్నాయా?',
    btn_not_sure: 'ఖచ్చితంగా తెలియదు',
    label_disease: 'వ్యాధి విచారణ',
    q_symptoms: '🔬 మీరు ఏ లక్షణాలను చూస్తున్నారు?',
    btn_select_symptoms: 'లక్షణాలను ఎంచుకోండి',
    label_fish_symptoms: 'చేపల లక్షణాలు',
    label_shrimp_symptoms: 'రొయ్యల లక్షణాలు',
    sym_red_ulcer: 'ఎర్ర మచ్చలు / పుండ్లు',
    sym_dropsy: 'డ్రాప్సీ (ఉబ్బిన బొడ్డు)',
    sym_fin_rot: 'ఫిన్ / టెయిల్ రాట్',
    sym_argulus: 'చేపల పేలు (ఆర్గులస్)',
    sym_gasping: 'ఉపరితలం వద్ద గాలి పీల్చడం',
    sym_other: 'ఇతర లక్షణాలు',
    sym_white_spots: 'తెల్ల మచ్చలు',
    sym_white_gut: 'వైట్ గట్ (తెల్లటి పేగు)',
    sym_red_body: 'ఎర్రటి శరీరం',
    sym_black_gills: 'నల్ల మొప్పలు',
    sym_muscle_cramps: 'కండరాల తిమ్మిరి',
    q_how_many_affected: '📊 ఎన్ని ప్రభావితమయ్యాయి?',
    btn_a_few: 'కొన్ని',
    btn_many: 'చాలా',
    btn_most_all: 'దాదాపు అన్ని',
    label_water_check: 'నీటి నాణ్యత తనిఖీ',
    q_current_water_color: '🎨 ప్రస్తుతం నీటి రంగు ఏమిటి?',
    btn_green: 'ఆకుపచ్చ',
    btn_clear: 'క్లియర్',
    q_smell_foam: '🫧 ఏదైనా చెడు వాసన లేదా అధిక నురుగు ఉందా?',
    btn_none: 'ఏమీ లేదు',
    btn_bad_smell: 'చెడు వాసన',
    btn_foam_bubbles: 'నురుగు/బుడగలు',
    label_feed_assess: 'మేత అంచనా',
    q_feed_status: '🍽️ మేత పరిస్థితి ఎలా ఉంది?',
    btn_normal: 'సాధారణం',
    btn_reduced: 'తగ్గించబడింది',
    btn_off_feed: 'మేత ఆగిపోయింది',
    q_feed_brand_q: '🏷️ మీరు ప్రస్తుతం ఏ మేత బ్రాండ్‌ను ఉపయోగిస్తున్నారు?',
    err_feed_brand_name: 'దయచేసి మేత బ్రాండ్ పేరును టైప్ చేయండి.',
    q_leftovers: '📊 చెక్ ట్రేలో ఏదైనా మిగిలిపోయిన మేత ఉందా?',
    btn_a_little: 'కొంచెం',
    btn_lot_of_feed: 'చాలా మేత',
    greet_event: 'నేను మీకు మెరుగ్గా సహాయం చేయడానికి కొన్ని త్వరిత ప్రశ్నలు అడగనివ్వండి.',
    msg_cancelled: '❌ విచారణ రద్దు చేయబడింది. నేను మీకు ఇంకే విధంగా సహాయపడగలను?',
    msg_not_understood: 'నాకు సరిగ్గా అర్థం కాలేదు. ప్రస్తుతానికి విచారణను ముగించాను. సహాయం కోసం "help" అని టైప్ చేయండి!',
    msg_analyzing: '🔍 మీ పరిస్థితిని విశ్లేషిస్తున్నాను...',
    msg_ai_fail_advice: 'మీరు వివరించిన దాని ఆధారంగా, ఇక్కడ తక్షణ చర్యలు ఉన్నాయి:',
    msg_consult_expert: 'సరైన రోగ నిర్ధారణ కోసం దయచేసి స్థానిక ఆక్వాకల్చర్ నిపుణుడిని సంప్రదించండి.'
  },
  Hindi: {
    label_mortality: 'मृत्यु दर रिपोर्ट',
    q_mort_find_dead: '💀 आपको कितने मरे हुए मिले?',
    btn_mort_1_50: '1-50',
    btn_mort_50_100: '50-100',
    btn_mort_100plus: '100+',
    btn_cancel: 'रद्द करें ❌',

    q_since_when: '📅 कब से?',
    btn_today: 'आज',
    btn_yesterday: 'कल',
    btn_2_3_days: '2-3 दिन',
    q_water_smell: '👃 क्या पानी में कोई असामान्य गंध है?',
    btn_yes: 'हाँ',
    btn_no: 'नहीं',
    q_body_signs_mort: '🔍 क्या कोई लक्षण दिखाई दे रहे हैं?',

    q_fish_body_signs: '🔍 क्या मछली के शरीर पर कोई दृश्य लक्षण हैं?',
    btn_no_signs: 'कोई लक्षण नहीं',
    btn_red_body: 'लाल शरीर',
    btn_white_spots: 'सफेद धब्बे',
    btn_red_sores: 'लाल घाव',
    btn_parasites: 'परजीवी',
    label_slow_growth: 'धीमी वृद्धि की जाँच',
    q_feed_using: '🍽️ आप कौन सा चारा उपयोग कर रहे हैं?',
    err_feed_name: 'कृपया फीड ब्रांड/प्रकार का नाम टाइप करें।',
    q_pond_color: '🎨 तालाब के पानी का रंग क्या है?',
    btn_green_dark: 'हरा / गहरा',
    btn_brown_black: 'भूरा / काला',
    q_white_gut_signs: '🔬 क्या सफेद आंत/मल के कोई लक्षण हैं?',
    btn_not_sure: 'निश्चित नहीं',
    label_disease: 'रोग की जाँच',
    q_symptoms: '🔬 आपको क्या लक्षण दिख रहे हैं?',
    btn_select_symptoms: 'लक्षण चुनें',
    label_fish_symptoms: 'मछली के लक्षण',
    label_shrimp_symptoms: 'झींगा के लक्षण',
    sym_red_ulcer: 'लाल धब्बे / अल्सर',
    sym_dropsy: 'ड्रॉप्सी (सूजा हुआ पेट)',
    sym_fin_rot: 'पूंछ/पंख सड़ना',
    sym_argulus: 'मछली जूँ (आर्गुलस)',
    sym_gasping: 'सतह पर हांफना',
    sym_other: 'अन्य लक्षण',
    sym_white_spots: 'सफेद धब्बे',
    sym_white_gut: 'सफेद आंत',
    sym_red_body: 'लाल शरीर',
    sym_black_gills: 'काले गलफड़े',
    sym_muscle_cramps: 'मांसपेशियों में ऐंठन',
    q_how_many_affected: '📊 कितने प्रभावित हैं?',
    btn_a_few: 'कुछ',
    btn_many: 'कई',
    btn_most_all: 'ज्यादातर/सभी',
    label_water_check: 'पानी की गुणवत्ता की जांच',
    q_current_water_color: '🎨 वर्तमान पानी का रंग क्या है?',
    btn_green: 'हरा',
    btn_clear: 'साफ',
    q_smell_foam: '🫧 क्या कोई दुर्गंध या अत्यधिक झाग है?',
    btn_none: 'कोई नहीं',
    btn_bad_smell: 'दुर्गंध',
    btn_foam_bubbles: 'झाग/बुलबुले',
    label_feed_assess: 'चारा मूल्यांकन',
    q_feed_status: '🍽️ चारे की स्थिति कैसी है?',
    btn_normal: 'सामान्य',
    btn_reduced: 'कम हो गया',
    btn_off_feed: 'चारा बंद है',
    q_feed_brand_q: '🏷️ आप वर्तमान में किस फीड ब्रांड का उपयोग कर रहे हैं?',
    err_feed_brand_name: 'कृपया फीड ब्रांड का नाम टाइप करें।',
    q_leftovers: '📊 क्या चेक ट्रे में कोई बचा हुआ चारा है?',
    btn_a_little: 'थोड़ा सा',
    btn_lot_of_feed: 'बहुत सारा चारा',
    greet_event: 'मुझे कुछ त्वरित प्रश्न पूछने दें ताकि मैं आपकी बेहतर मदद कर सकूँ।',
    msg_cancelled: '❌ जाँच रद्द कर दी गई। मैं आपकी और कैसे मदद कर सकता हूँ?',
    msg_not_understood: 'मुझे ठीक से समझ नहीं आया। मैंने अभी के लिए जाँच बंद कर दी है। मदद के लिए "help" टाइप करें!',
    msg_analyzing: '🔍 आपकी स्थिति का विश्लेषण कर रहा हूँ...',
    msg_ai_fail_advice: 'आपने जो वर्णन किया है उसके आधार पर, यहाँ तत्काल कदम उठाए गए हैं:',
    msg_consult_expert: 'उचित निदान के लिए कृपया स्थानीय जलीय कृषि विशेषज्ञ से परामर्श करें.'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  startEventFollowUp,
  handleEventStep,
  detectEventType,
  EVENT_TREES,
  translations,
  t
};
