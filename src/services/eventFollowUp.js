const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { answerQuestion } = require('./ai');
const productEngine = require('./productEngine');

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
    label: 'Mortality Report',
    steps: [
      {
        key: 'how_many',
        prompt: '💀 How many died?',
        buttons: [
          { id: 'mort_few', title: '1–50' },
          { id: 'mort_many', title: 'More than 50' },
          { id: 'cancel_flow', title: 'Cancel ❌' },
        ],
        parseButton: (input) => {
          if (input.includes('cancel') || input === 'cancel_flow') return 'cancel';
          if (input.includes('1') || input.includes('50') || input === 'mort_few' || input === 'mort_some') return '1-50';
          if (input.includes('more') || input === 'mort_many') return '50+';
          return null;
        },
      },
      {
        key: 'since_when',
        prompt: '📅 Since when?',
        buttons: [
          { id: 'mort_today', title: 'Today' },
          { id: 'mort_yesterday', title: 'Yesterday' },
          { id: 'mort_days', title: '2-3 days' },
        ],
        parseButton: (input) => {
          if (input.includes('today') || input === 'mort_today') return 'today';
          if (input.includes('yesterday') || input === 'mort_yesterday') return 'yesterday';
          if (input.includes('2') || input.includes('3') || input.$includes('day') || input === 'mort_days') return '2-3_days';
          if (input.includes('week') || input === 'mort_week') return 'this_week';
          return null;
        },
      },
      {
        key: 'water_smell',
        prompt: '👃 Any unusual water smell?',
        buttons: [
          { id: 'mort_smell_no', title: 'No' },
          { id: 'mort_smell_yes', title: 'Yes' },
        ],
        parseButton: (input) => {
          if (input === 'no' || input === 'mort_smell_no') return 'no';
          if (input === 'yes' || input === 'mort_smell_yes') return 'yes';
          return null;
        },
      },
      {
        key: 'body_signs',
        prompt: '🔍 Any visible signs on the body?',
        buttons: [
          { id: 'mort_sign_none', title: 'No signs' },
          { id: 'mort_sign_red', title: 'Red body' },
          { id: 'mort_sign_white', title: 'White spots' },
        ],
        parseButton: (input) => {
          if (input === 'no' || input.includes('no sign') || input === 'mort_sign_none') return 'none';
          if (input.includes('red') || input.includes('sores') || input === 'mort_sign_red' || input === 'mort_sign_sores') return 'red_body_sores';
          if (input.includes('white') || input.includes('spot') || input === 'mort_sign_white') return 'white_spots';
          if (input.includes('parasite') || input === 'mort_sign_parasite') return 'parasites';
          return null;
        },
      },
    ],
  },

  slow_growth: {
    label: 'Slow Growth Investigation',
    steps: [
      {
        key: 'feed_type',
        prompt: '🍽️ What feed are you using?',
        type: 'text',
        validate: (v) => v && v.trim().length >= 2,
        errorMsg: 'Please type the feed brand/type name.',
      },
      {
        key: 'pond_color',
        prompt: '🎨 What is the pond water color?',
        buttons: [
          { id: 'sg_dark', title: 'Green / Dark' },
          { id: 'sg_brown', title: 'Brown / Black' },
          { id: 'cancel_flow', title: 'Cancel ❌' },
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
        prompt: '🔬 Any white gut/feces signs?',
        buttons: [
          { id: 'sg_gut_no', title: 'No' },
          { id: 'sg_gut_yes', title: 'Yes' },
          { id: 'sg_gut_unsure', title: 'Not sure' },
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
    label: 'Disease Investigation',
    steps: [
      {
        key: 'symptoms',
        prompt: '🔬 What symptoms do you see?',
        type: 'list',
        listButtonLabel: 'Select Symptoms',
        listSections: (lang, species) => {
          const isFish = isFishSpecies(species);
          if (isFish) {
            return [{
              title: 'Fish Symptoms',
              rows: [
                { id: 'dis_sores', title: 'Red spots / Ulcers' },
                { id: 'disease_dropsy', title: 'Dropsy (Swollen Belly)' },
                { id: 'dis_rot', title: 'Fin / Tail Rot' },
                { id: 'dis_parasite', title: 'Fish lice (Argulus)' },
                { id: 'disease_gasping', title: 'Gasping at surface' },
                { id: 'dis_other', title: 'Other signs' },
                { id: 'cancel_flow', title: 'Cancel ❌' }
              ]
            }];
          } else {
            return [{
              title: 'Shrimp Symptoms',
              rows: [
                { id: 'dis_spots', title: 'White spots' },
                { id: 'disease_white_gut', title: 'White gut' },
                { id: 'dis_red_other', title: 'Red body' },
                { id: 'disease_black_gills', title: 'Black gills' },
                { id: 'disease_muscle_cramps', title: 'Muscle cramps' },
                { id: 'dis_other', title: 'Other signs' },
                { id: 'cancel_flow', title: 'Cancel ❌' }
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
        prompt: '📊 How many are affected?',
        buttons: [
          { id: 'dis_few', title: 'A few' },
          { id: 'dis_many', title: 'Many' },
          { id: 'dis_most', title: 'Most/All' },
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
    label: 'Water Quality Check',
    steps: [
      {
        key: 'water_color',
        prompt: '🎨 What is the current water color?',
        buttons: [
          { id: 'wq_green', title: 'Green' },
          { id: 'wq_brown', title: 'Brown / Black' },
          { id: 'wq_clear', title: 'Clear' },
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
        prompt: '🫧 Any bad smell or excessive foam?',
        buttons: [
          { id: 'wq_sf_none', title: 'None' },
          { id: 'wq_sf_smell', title: 'Bad smell' },
          { id: 'wq_sf_foam', title: 'Foam/Bubbles' },
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
    label: 'Feed Assessment',
    steps: [
      {
        key: 'feed_status',
        prompt: '🍽️ How is the feeding status?',
        buttons: [
          { id: 'fd_normal', title: 'Normal' },
          { id: 'fd_reduced', title: 'Reduced' },
          { id: 'fd_off', title: 'Off-feed (Stopped)' },
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
        prompt: '🏷️ Which feed brand are you currently using?',
        type: 'text',
        validate: (v) => v && v.trim().length >= 2,
        errorMsg: 'Please type the name of the feed brand.',
      },
      {
        key: 'leftovers',
        prompt: '📊 Any leftover feed in the check tray?',
        buttons: [
          { id: 'fd_lo_none', title: 'No' },
          { id: 'fd_lo_some', title: 'A little' },
          { id: 'fd_lo_many', title: 'Lot of feed' },
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

  await sendTextMessage(phone,
    `📋 *${tree.label}*\n\nLet me ask a few quick questions so I can help you better.`
  );

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

  // Handle free text step
  if (stepDef.type === 'text') {
    if (!stepDef.validate(message)) {
      await sendTextMessage(phone, stepDef.errorMsg);
      return true;
    }
    updateStateData(phone, { [stepDef.key]: message.trim() });
  } else {
    const value = stepDef.parseButton(input);
    
    // Check for explicit cancel or exit keyword
    if (value === 'cancel' || ['stop', 'exit', 'cancel', 'menu', 'hi', 'hii', 'hello'].includes(input)) {
      clearState(phone);
      await sendTextMessage(phone, '❌ Investigation cancelled. How can I help you otherwise?');
      return true;
    }

    if (!value) {
      // Logic to prevent infinite loops: allow 2 attempts
      const attempts = (state.attempts || 0) + 1;
      if (attempts >= 2) {
        clearState(phone);
        await sendTextMessage(phone, 'I didn\'t quite get that. I\'ve closed the investigation for now so you can chat normally. Type "help" if you need me!');
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

  if (stepIndex >= tree.steps.length) return;

  let stepDef = JSON.parse(JSON.stringify(tree.steps[stepIndex])); // deep copy

  // Dynamic customization for FISH species
  if (isFishSpecies(state.species)) {
    if (state.eventType === 'disease' && stepDef.key === 'symptoms') {
      // Handled by listSections dynamically
    }
    if (state.eventType === 'mortality' && stepDef.key === 'body_signs') {
      stepDef.prompt = '🔍 Any visible signs on the fish body?';
      stepDef.buttons = [
        { id: 'mort_sign_none', title: 'No signs' },
        { id: 'mort_sign_sores', title: 'Red sores' },
        { id: 'mort_sign_parasite', title: 'Parasites' },
      ];
    }
  }

  if (stepDef.type === 'text') {
    await sendTextMessage(phone, stepDef.prompt);
  } else if (stepDef.type === 'list') {
    const { getFarmerById } = require('../models/database');
    const farmer = await getFarmerById(state.farmerId);
    const lang = farmer?.preferred_language || 'English';
    const sections = stepDef.listSections(lang, state.species);
    await sendListMessage(phone, stepDef.prompt, stepDef.listButtonLabel || 'Select Option', sections);
  } else {
    await sendButtonMessage(phone, stepDef.prompt, stepDef.buttons);
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

  // Send thinking message
  await sendTextMessage(phone, '🔍 Analyzing your situation...');

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
    
    await sendTextMessage(phone, `📋 *${tree.label} — Assessment*\n\n${diagnosis}${recommendedProductSection ? '\n\n' + recommendedProductSection : ''}`);
  } catch (err) {
    console.error('❌ Event AI analysis failed:', err.message);
    await sendTextMessage(phone,
      `Based on what you've described, here are immediate steps:\n\n` +
      getDefaultEventAdvice(state.eventType, data) +
      `\n\n⚠️ *Please consult a local aquaculture expert for proper diagnosis.*`
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

module.exports = {
  startEventFollowUp,
  handleEventStep,
  detectEventType,
  EVENT_TREES,
};
