const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, updatePond, saveChatHistory, markPendingCheckInsCompleted, getRecentPondLogs } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { calculateHealthScore } = require('./healthScore');
const productEngine = require('./productEngine');
const { findRecentAnswer } = require('../utils/contextHelper');
const intelligence = require('./intelligence');



/**
 * Daily Check-In — Rotating Groups
 *
 * Monday   → Feed Group (3 questions)
 * Wednesday → Water Group (3 questions)
 * Friday   → Health Group (2 questions — NO proactive mortality question)
 *
 * All questions use button-tap input. Farmers never type long answers.
 */

function isFishSpecies(species) {
  if (!species) return false;
  const s = species.toLowerCase();
  const fishKeywords = ['fish', 'tilapia', 'rohu', 'catla', 'mrigal', 'pangasius', 'seabass', 'murrel', 'jalidi', 'pandugappa', 'imc'];
  return fishKeywords.some(k => s.includes(k));
}

// ========================
// FEED GROUP (Monday)
// ========================

const FEED_STEPS = [
  {
    key: 'feed_brand',
    askOnce: true, // only ask first time, then skip
    prompt: (lang) => t('q_feed_brand', lang),
    type: 'text', // free text — only exception
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: (lang) => t('err_feed_brand', lang),
  },
  {
    key: 'feed_kg',
    prompt: (lang) => t('q_feed_kg', lang),
    buttons: (lang) => [
      { id: 'feed_lt10', title: t('btn_lt10', lang) },
      { id: 'feed_10_30', title: t('btn_10_30', lang) },
      { id: 'feed_30_50', title: t('btn_30_50', lang) },
      { id: 'feed_50plus', title: t('btn_50plus', lang) },
    ],
    parseButton: (input) => {
      if (input.includes('less') || (input.includes('10') && !input.includes('30')) || input === 'feed_lt10') return '<10';
      if ((input.includes('10') && input.includes('30')) || input === 'feed_10_30') return '10-30';
      if ((input.includes('30') && input.includes('50')) || input === 'feed_30_50') return '30-50';
      if (input.includes('50') || input === 'feed_50plus') return '50+';
      return null;
    },
  },
  {
    key: 'feed_times',
    prompt: (lang) => t('q_feed_times', lang),
    buttons: (lang) => [
      { id: 'times_1', title: t('btn_1_time', lang) },
      { id: 'times_2', title: t('btn_2_times', lang) },
      { id: 'times_3', title: t('btn_3_4_times', lang) },
    ],
    parseButton: (input) => {
      if (input === '1' || input === 'times_1' || input.includes('1 time')) return 1;
      if (input === '2' || input === 'times_2' || input.includes('2 time')) return 2;
      if (input === '3' || input === '4' || input === 'times_3' || input.includes('3') || input.includes('4')) return 3;
      return null;
    },
  },
];

// ========================
// WATER GROUP (Wednesday)
// ========================

const WATER_STEPS = [
  {
    key: 'water_color',
    prompt: (lang) => t('q_water_color', lang),
    buttons: (lang) => [
      { id: 'color_green', title: t('btn_color_green', lang) },
      { id: 'color_dkgreen', title: t('btn_color_dark_green', lang) },
      { id: 'color_brown', title: t('btn_color_brown_black', lang) },
    ],
    parseButton: (input) => {
      if ((input.includes('green') && !input.includes('dark')) || input === 'color_green') return 'green';
      if (input.includes('dark') || input === 'color_dkgreen') return 'dark_green';
      if (input.includes('brown') || input.includes('black') || input === 'color_brown') return 'brown_black';
      if (input.includes('clear') || input === 'color_clear') return 'clear';
      return null;
    },
  },
  {
    key: 'bad_smell',
    prompt: (lang) => t('q_bad_smell', lang),
    buttons: (lang) => [
      { id: 'smell_no', title: t('btn_smell_no', lang) },
      { id: 'smell_mild', title: t('btn_smell_mild', lang) },
      { id: 'smell_strong', title: t('btn_smell_strong', lang) },
    ],
    parseButton: (input) => {
      if (input === 'no' || input === 'smell_no') return 'no';
      if (input.includes('mild') || input === 'smell_mild') return 'mild';
      if (input.includes('strong') || input.includes('yes') || input === 'smell_strong') return 'strong';
      return null;
    },
  },
  {
    key: 'foam_bubbles',
    prompt: (lang) => t('q_foam_bubbles', lang),
    buttons: (lang) => [
      { id: 'foam_no', title: t('btn_no', lang) },
      { id: 'foam_yes', title: t('btn_yes', lang) },
    ],
    parseButton: (input) => {
      if (input === 'no' || input === 'foam_no') return 'no';
      if (input === 'yes' || input === 'foam_yes') return 'yes';
      return null;
    },
  },
];

// ========================
// HEALTH GROUP (Friday) — NO mortality question from our side
// ========================

const HEALTH_STEPS = [
  {
    key: 'disease_signs',
    prompt: (lang) => t('q_disease_signs', lang),
    type: 'list',
    listButtonLabel: (lang) => t('btn_select_symptoms', lang),
    listSections: (lang, species) => {
      const isFish = isFishSpecies(species);
      if (isFish) {
        return [
          {
            title: t('label_fish_symptoms', lang),
            rows: [
              { id: 'disease_no', title: t('sym_no_signs', lang) },
              { id: 'disease_red_ulcer', title: t('sym_red_ulcer', lang) },
              { id: 'disease_dropsy', title: t('sym_dropsy', lang) },
              { id: 'disease_fin_rot', title: t('sym_fin_rot', lang) },
              { id: 'disease_argulus', title: t('sym_argulus', lang) },
              { id: 'disease_gasping', title: t('sym_gasping', lang) },
              { id: 'disease_other', title: t('sym_other', lang) }
            ]
          }
        ];
      } else {
        return [
          {
            title: t('label_shrimp_symptoms', lang),
            rows: [
              { id: 'disease_no', title: t('sym_no_signs', lang) },
              { id: 'disease_white_spots', title: t('sym_white_spots', lang) },
              { id: 'disease_white_gut', title: t('sym_white_gut', lang) },
              { id: 'disease_red_body', title: t('sym_red_body', lang) },
              { id: 'disease_black_gills', title: t('sym_black_gills', lang) },
              { id: 'disease_muscle_cramps', title: t('sym_muscle_cramps', lang) },
              { id: 'disease_other', title: t('sym_other', lang) }
            ]
          }
        ];
      }
    },
    parseButton: (input) => {
      if (input === 'no' || input.includes('no sign') || input === 'disease_no') return 'none';
      if (input.includes('white spot') || input === 'disease_white_spots') return 'white_spots';
      if (input.includes('red') || input === 'disease_red_body' || input === 'disease_red_ulcer') return 'red_body';
      if (input.includes('gut') || input === 'disease_white_gut') return 'white_gut';
      if (input.includes('gills') || input === 'disease_black_gills') return 'black_gills';
      if (input.includes('cramp') || input === 'disease_muscle_cramps') return 'muscle_cramps';
      if (input.includes('dropsy') || input === 'disease_dropsy') return 'dropsy';
      if (input.includes('fin') || input.includes('rot') || input === 'disease_fin_rot') return 'fin_tail_rot';
      if (input.includes('lice') || input.includes('argulus') || input === 'disease_argulus') return 'parasites';
      if (input.includes('gasping') || input === 'disease_gasping') return 'gasping';
      if (input.includes('other') || input === 'disease_other') return 'other';
      return null;
    },
  },
  {
    key: 'disease_other_desc',
    condition: (state) => state.data && state.data.disease_signs === 'other',
    prompt: (lang) => t('q_other_desc', lang),
    type: 'text',
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: (lang) => t('err_other_desc', lang),
  },
  {
    key: 'growth_status',
    prompt: (lang) => t('q_growth_normal', lang),
    buttons: (lang) => [
      { id: 'growth_yes', title: t('btn_growth_yes', lang) },
      { id: 'growth_slow', title: t('btn_growth_slow', lang) },
      { id: 'growth_unsure', title: t('btn_growth_unsure', lang) },
    ],
    parseButton: (input) => {
      if (input === 'yes' || input.includes('normal') || input === 'growth_yes') return 'normal';
      if (input.includes('slow') || input === 'growth_slow') return 'slow';
      if (input.includes('not sure') || input.includes('unsure') || input === 'growth_unsure') return 'not_sure';
      return null;
    },
  },
];

const GROUP_MAP = {
  daily_feed: { steps: FEED_STEPS, logGroup: 'feed', label: 'Feed Check-In' },
  daily_water: { steps: WATER_STEPS, logGroup: 'water', label: 'Water Check-In' },
  daily_health: { steps: HEALTH_STEPS, logGroup: 'health', label: 'Health Check-In' },
};

// ========================
// START CHECK-IN
// ========================

async function startDailyCheckIn(phone, farmerId, groupType) {
  const config = GROUP_MAP[groupType];
  if (!config) return;

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(farmerId);
  const lang = farmer?.preferred_language || 'English';

  if (!pond) {
    await sendTextMessage(phone, t('err_no_pond', lang));
    return;
  }

  // Start conversation state
  setState(phone, {
    flow: groupType,
    step: 0,
    data: {},
    farmerId,
    pondId: pond.id,
    species: pond.species || 'vannamei',
  });


  let greeting = getCheckInGreeting(groupType, lang);
  
  // Intelligence: Add Proactive Follow-up if relevant
  const followUp = await intelligence.getProactiveFollowUp(pond.id, lang);
  if (followUp) {
    greeting = `💬 ${followUp}\n\n` + greeting;
  }

  if (groupType === 'daily_health') {

    try {
      const recentLogs = await getRecentPondLogs(pond.id, 'health', 3);
      const lastDiseaseLog = recentLogs.find(l => l.log_data && l.log_data.disease_signs && l.log_data.disease_signs !== 'none');
      if (lastDiseaseLog) {
        const lastDisease = lastDiseaseLog.log_data.disease_signs.replace(/_/g, ' ');
        if (lang === 'Telugu') {
          greeting += `\n\nమీరు ఇటీవల *${lastDisease}* గురించి నివేదించినట్లు నేను గమనించాను. మీరు ఇప్పటికీ దీన్ని లేదా ఇతర లక్షణాలను చూస్తున్నారా?`;
        } else if (lang === 'Hindi') {
          greeting += `\n\nमैंने देखा कि आपने हाल ही में *${lastDisease}* की सूचना दी थी। क्या आप अभी भी इसे या कोई अन्य लक्षण देख रहे हैं?`;
        } else {
          greeting += `\n\nI noticed you recently reported *${lastDisease}*. Are you still seeing this, or any other signs?`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch recent health logs for context:', err.message);
    }
  }

  await sendTextMessage(phone, greeting);
  await askDailyQuestion(phone, groupType);
}

// ========================
// HANDLE DAILY STEP
// ========================

async function handleDailyStep(phone, message, groupType) {
  const state = getState(phone);
  if (!state || state.flow !== groupType) return false;

  const config = GROUP_MAP[groupType];
  const steps = config.steps;
  const stepIndex = state.step;

  if (stepIndex >= steps.length) return false;

  const stepDef = steps[stepIndex];
  const input = message.toLowerCase().trim();

  // Handle free text step (feed brand)
  if (stepDef.type === 'text') {
    const lang = state.lang || 'English';
    if (!stepDef.validate(message)) {
      await sendTextMessage(phone, typeof stepDef.errorMsg === 'function' ? stepDef.errorMsg(lang) : stepDef.errorMsg);
      return true;
    }
    updateStateData(phone, { [stepDef.key]: message.trim() });

    // Save feed brand to pond (persistent)
    if (stepDef.key === 'feed_brand') {
      try {
        await updatePond(state.pondId, { feed_brand: message.trim() });
      } catch (err) {
        console.warn('⚠️ Could not save feed brand to pond:', err.message);
      }
    }
  } else {
    // Button step
    const value = stepDef.parseButton(input);
    if (!value) {
      // Re-ask the question
      await askDailyQuestion(phone, groupType);
      return true;
    }
    updateStateData(phone, { [stepDef.key]: value });
  }

  // Skip steps that have a condition that is not met
  let updatedState = getState(phone);
  while (updatedState.step < steps.length && steps[updatedState.step].condition && !steps[updatedState.step].condition(updatedState)) {
    setState(phone, { ...updatedState, step: updatedState.step + 1 });
    updatedState = getState(phone);
  }

  // Check if all steps done
  if (updatedState.step >= steps.length) {
    await finalizeDailyCheckIn(phone, groupType);
    return true;
  }

  // Ask next question
  await askDailyQuestion(phone, groupType);
  return true;
}

// ========================
// ASK QUESTION
// ========================

async function askDailyQuestion(phone, groupType) {
  const state = getState(phone);
  const config = GROUP_MAP[groupType];
  const steps = config.steps;
  const stepIndex = state.step;

  if (stepIndex >= steps.length) return;

  const stepDef = steps[stepIndex];
  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  // --- SMART SKIP LOGIC ---
  // Skip if we have metadata or a very recent answer (last 24h)
  const recentValue = await findRecentAnswer(state.pondId, stepDef.key);

  if (recentValue && !state.attempts) {
    console.log(`🧠 Daily Smart Skip: ${stepDef.key} -> ${recentValue}`);
    
    updateStateData(phone, { 
      [stepDef.key]: recentValue,
      step: state.step + 1
    });

    // Notify user
    let skipMsg = `✅ I already have your ${stepDef.key.replace(/_/g, ' ')}: *${recentValue}*`;
    if (lang === 'Telugu') skipMsg = `✅ మీ ${stepDef.key.replace(/_/g, ' ')} గురించి నాకు ఇప్పటికే తెలుసు: *${recentValue}*`;
    if (lang === 'Hindi') skipMsg = `✅ मुझे आपका ${stepDef.key.replace(/_/g, ' ')} पहले से पता है: *${recentValue}*`;
    
    await sendTextMessage(phone, skipMsg);

    return askDailyQuestion(phone, groupType);
  }
  // -------------------------


  const prompt = typeof stepDef.prompt === 'function' ? stepDef.prompt(lang) : stepDef.prompt;

  if (stepDef.type === 'text') {
    await sendTextMessage(phone, prompt);
  } else if (stepDef.type === 'list') {
    const sections = stepDef.listSections(lang, state.species);
    const listButtonLabel = typeof stepDef.listButtonLabel === 'function' ? stepDef.listButtonLabel(lang) : stepDef.listButtonLabel;
    await sendListMessage(phone, prompt, listButtonLabel, sections);
  } else {
    const buttons = typeof stepDef.buttons === 'function' ? stepDef.buttons(lang) : stepDef.buttons;
    await sendButtonMessage(phone, prompt, buttons);
  }
}

// ========================
// FINALIZE
// ========================

async function finalizeDailyCheckIn(phone, groupType) {
  const state = getState(phone);
  const data = state.data;
  const config = GROUP_MAP[groupType];

  // Get farmer language for translated advice
  const { getFarmerById, getRecentPondLogs, getPondById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';
  const pond = await getPondById(state.pondId);

  // Save to pond_logs
  await insertPondLog({
    pond_id: state.pondId,
    log_group: config.logGroup,
    log_data: data,
  });

  // Calculate and update health score
  try {
    await calculateHealthScore(state.pondId);
  } catch (err) {
    console.warn('⚠️ Health score calculation failed:', err.message);
  }

  clearState(phone);

  // Build confirmation with alerts
  let confirmMsg = `✅ *${t(config.logGroup + '_checkin', lang)} ${t('recorded', lang)}!*\n\n`;
  confirmMsg += formatLogSummary(config.logGroup, data, lang);

  // Add alerts
  const alerts = generateAlerts(config.logGroup, data, lang);
  if (alerts.length > 0) {
    confirmMsg += `\n\n${alerts.join('\n')}`;
  }

  // --- NEW: Recommendation Engine Derived Logic ---
  let recommendationMsg = "";
  const pondSizeValue = productEngine.getPondSizeValue(pond?.pond_size);

  if (config.logGroup === 'water') {
    // IF color = dark/brown/black AND smell = strong -> Ammonia/Organic load issue
    if (data.water_color === 'brown_black' && data.bad_smell === 'strong') {
      const rec = productEngine.getRecommendation('ammonia', { pondSizeValue });
      recommendationMsg = "\n\n" + productEngine.formatRecommendation(rec);
    }
  } else if (config.logGroup === 'feed') {
    // IF feed qty high AND growth = slow (from Friday) -> Poor feed conversion
    try {
      const recentHealthLogs = await getRecentPondLogs(state.pondId, 'health', 1);
      const lastGrowthStatus = recentHealthLogs[0]?.log_data?.growth_status;
      
      if (lastGrowthStatus === 'slow' && (data.feed_kg === '30-50' || data.feed_kg === '50+')) {
        const rec = productEngine.getRecommendation('slow_growth', { pondSizeValue });
        recommendationMsg = "\n\n💡 *Cross-Check Insight:* Growth was slow recently despite high feeding. You may have poor feed conversion.\n" + productEngine.formatRecommendation(rec);
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch cross-day health data:', err.message);
    }
  }

  if (recommendationMsg) {
    confirmMsg += recommendationMsg;
  }

  // Intelligence: Check for anomalies
  const anomalyAlert = await intelligence.checkAnomalies(state.pondId, data, config.logGroup, lang);
  if (anomalyAlert) {
    confirmMsg += `\n\n⚠️ *Alert:* ${anomalyAlert}`;
  }

  confirmMsg += `\n\n${t('great_job', lang)} 🎯`;

  // Intelligence: Check for Progressive Onboarding (missing metadata)
  const onboardingQ = await intelligence.getProgressiveOnboardingQuestion(state.pondId, lang);
  if (onboardingQ) {
    confirmMsg += `\n\n💡 ${onboardingQ.prompt}\n(Just reply to answer)`;
    // Note: We don't change the flow state here to avoid interrupting the completion, 
    // but the next message from the user will be handled by the AI or we could set a sub-state.
    // For now, we'll just let the AI handle the answer or log it if the user replies.
  }


  // Save to chat history and clear pending follow-ups
  try {
    await markPendingCheckInsCompleted(state.farmerId);

    const summaryMsg = `[${config.label}] ${formatLogSummary(config.logGroup, data).replace(/\n/g, ' | ').trim()}`;
    await saveChatHistory({
      farmer_id: state.farmerId,
      message: summaryMsg,
      response: confirmMsg,
      message_type: 'checkin',
    });
  } catch (err) {
    console.warn('⚠️ Could not save check-in to chat history:', err.message);
  }

  await sendTextMessage(phone, confirmMsg);
}

// ========================
// HELPERS
// ========================

function getCheckInGreeting(groupType, lang = 'English') {
  if (groupType === 'daily_feed') return t('greet_feed', lang);
  if (groupType === 'daily_water') return t('greet_water', lang);
  if (groupType === 'daily_health') return t('greet_health', lang);
  return t('greet_default', lang);
}

function generateAlerts(logGroup, data, lang = 'English') {
  const alerts = [];

  if (logGroup === 'water') {
    if (data.water_color === 'brown_black') alerts.push(t('alert_water_brown', lang));
    if (data.bad_smell === 'strong') alerts.push(t('alert_smell_strong', lang));
    if (data.bad_smell === 'mild') alerts.push(t('alert_smell_mild', lang));
    if (data.foam_bubbles === 'yes') alerts.push(t('alert_foam', lang));
  }

  if (logGroup === 'health') {
    if (data.disease_signs === 'white_spots') alerts.push(t('alert_disease_white', lang));
    if (data.disease_signs === 'red_body') alerts.push(t('alert_disease_red', lang));
    if (data.disease_signs === 'white_gut') alerts.push(t('alert_disease_gut', lang));
    if (data.growth_status === 'slow') alerts.push(t('alert_growth_slow', lang));
  }

  if (logGroup === 'feed') {
    if (data.feed_times === 1) {
      alerts.push(t('alert_feed_1x', lang));
    } else if (data.feed_times === 2) {
      alerts.push(t('alert_feed_2x', lang));
    }
    
    if (data.feed_kg === '<10' && data.feed_times >= 3) {
      alerts.push(t('alert_feed_low', lang));
    }
  }

  return alerts;
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    recorded: 'recorded',
    feed_checkin: 'Feed Check-In',
    water_checkin: 'Water Check-In',
    health_checkin: 'Health Check-In',
    label_brand: 'Brand',
    label_qty: 'Quantity',
    label_freq: 'Frequency',
    label_color: 'Color',
    label_smell: 'Smell',
    label_foam: 'Foam',
    label_disease: 'Disease',
    label_growth: 'Growth',
    great_job: 'Great job keeping track!',
    alert_feed_1x: '⚠️ *Action Needed:* Feeding only 1 time per day is very low! Your shrimp/fish will not grow well. Please feed 3-4 times a day.',
    alert_feed_2x: '💡 *Advice:* Consider feeding 3-4 times per day. More frequent, smaller meals lead to much better growth and less waste.',
    alert_feed_low: '💡 Low feed amount with high frequency — verify this is correct for your stocking density.',
    alert_water_brown: '⚠️ *Warning:* Brown/black water indicates high organic load. Consider immediate water exchange and increase aeration.',
    alert_smell_strong: '🚨 *Danger:* Strong smell means low oxygen or high ammonia. Increase all aerators immediately!',
    alert_smell_mild: '⚠️ *Warning:* Mild smell detected. Monitor your DO levels closely and clean your check trays.',
    alert_foam: '⚠️ *Warning:* Unusual foam/bubbles often mean high organic waste. Reduce feed slightly and check water parameters.',
    alert_disease_white: '🚨 *Emergency:* White spots detected! This is likely WSSV. Consult your local expert immediately and stop water exchange.',
    alert_disease_red: '⚠️ *Warning:* Red body may indicate Vibriosis. Check your soil quality and apply probiotics.',
    alert_disease_gut: '⚠️ *Warning:* White gut detected. This could be EHP or infection. Reduce feed and apply gut probiotics.',
    alert_growth_slow: '📉 *Slow Growth:* Check if your feed quality is good and if your water parameters (pH, DO) are stable.',
    btn_update: 'Update Now 📝',
    btn_weekly: 'Weekly Report 📋',
    label_fish_symptoms: 'Fish Symptoms',
    label_shrimp_symptoms: 'Shrimp Symptoms',
    sym_no_signs: 'No signs',
    sym_red_ulcer: 'Red spots / Ulcers',
    sym_dropsy: 'Dropsy (Swollen Belly)',
    sym_fin_rot: 'Fin / Tail Rot',
    sym_argulus: 'Fish lice (Argulus)',
    sym_gasping: 'Gasping at surface',
    sym_white_spots: 'White spots',
    sym_white_gut: 'White gut',
    sym_red_body: 'Red body',
    sym_black_gills: 'Black gills',
    sym_muscle_cramps: 'Muscle cramps',
    sym_other: 'Other signs',
    q_feed_brand: '🍽️ What feed brand are you using?',
    err_feed_brand: 'Please type your feed brand name.',
    q_feed_kg: '🍽️ How many kg of feed did you use yesterday?',
    btn_lt10: 'Less than 10 kg',
    btn_10_30: '10–30 kg',
    btn_30_50: '30–50 kg',
    btn_50plus: 'More than 50 kg',
    q_feed_times: '⏰ How many times do you feed per day?',
    btn_1_time: '1 time',
    btn_2_times: '2 times',
    btn_3_4_times: '3-4 times',
    q_water_color: '🎨 What is the pond water color today?',
    btn_color_green: '🟢 Green',
    btn_color_dark_green: '🟤 Dark Green',
    btn_color_brown_black: '🟫 Brown/Black',
    q_bad_smell: '👃 Any bad smell from the pond?',
    btn_smell_no: 'No',
    btn_smell_mild: 'Yes, mild',
    btn_smell_strong: 'Yes, strong',
    q_foam_bubbles: '🫧 Any unusual foam or bubbles?',
    btn_yes: 'Yes',
    btn_no: 'No',
    q_disease_signs: '🔬 Any disease signs in your pond?',
    btn_select_symptoms: 'Select Symptoms',
    q_other_desc: '📝 Please describe the other signs you are seeing:',
    err_other_desc: 'Please type the signs you are seeing.',
    q_growth_normal: '📈 Are your shrimp/fish growing normally?',
    btn_growth_yes: 'Yes, normal',
    btn_growth_slow: 'Slower than usual',
    btn_growth_unsure: 'Not sure',
    greet_feed: '🍽️ *Feed Check-In*\nQuick questions about feeding. Takes 30 seconds!',
    greet_water: '💧 *Water Check-In*\nLet\'s check your pond water. Just 3 taps!',
    greet_health: '🔬 *Health Check-In*\nQuick health check for your pond.',
    greet_default: '📋 Check-in time!',
    err_no_pond: '⚠️ No pond found. Please complete setup first.'
  },
  Telugu: {
    recorded: 'రికార్డ్ చేయబడింది',
    feed_checkin: 'మేత చెక్-ఇన్',
    water_checkin: 'నీటి చెక్-ఇన్',
    health_checkin: 'ఆరోగ్య చెక్-ఇన్',
    label_brand: 'బ్రాండ్',
    label_qty: 'పరిమాణం',
    label_freq: 'ఫ్రీక్వెన్సీ',
    label_color: 'రంగు',
    label_smell: 'వాసన',
    label_foam: 'నురుగు',
    label_disease: 'వ్యాధి',
    label_growth: 'పెరుగుదల',
    great_job: 'ట్రాక్ చేస్తున్నందుకు అభినందనలు!',
    alert_feed_1x: '⚠️ *చర్య అవసరం:* రోజుకు కేవలం 1 సారి మేత వేయడం చాలా తక్కువ! దీనివల్ల పెరుగుదల బాగుండదు. దయచేసి రోజుకు 3-4 సార్లు మేత వేయండి.',
    alert_feed_2x: '💡 *సలహా:* రోజుకు 3-4 సార్లు మేత వేయడం మంచిది. తక్కువ పరిమాణంలో ఎక్కువ సార్లు వేయడం వల్ల పెరుగుదల బాగుంటుంది.',
    alert_feed_low: '💡 మేత తక్కువగా ఉంది కానీ ఫ్రీక్వెన్సీ ఎక్కువగా ఉంది — మీ స్టాకింగ్ ప్రకారం ఇది సరిగ్గా ఉందో లేదో చూసుకోండి.',
    alert_water_brown: '⚠️ *హెచ్చరిక:* బ్రౌన్/బ్లాక్ నీరు అంటే వ్యర్థాలు ఎక్కువ ఉన్నాయని అర్థం. నీటిని మార్చండి మరియు ఎరేటర్లను పెంచండి.',
    alert_smell_strong: '🚨 *ప్రమాదం:* బలమైన వాసన అంటే ఆక్సిజన్ చాలా తక్కువగా ఉందని అర్థం. వెంటనే అన్ని ఎరేటర్లను ఆన్ చేయండి!',
    alert_smell_mild: '⚠️ *హెచ్చరిక:* స్వల్ప వాసన ఉంది. ఆక్సిజన్ లెవల్స్ చెక్ చేసుకోండి.',
    alert_foam: '⚠️ *హెచ్చరిక:* అసాధారణమైన నురుగు వ్యర్థాలను సూచిస్తుంది. మేతను కొద్దిగా తగ్గించండి.',
    alert_disease_white: '🚨 *అత్యవసరం:* తెల్ల మచ్చలు కనిపించాయి! ఇది WSSV కావచ్చు. వెంటనే నిపుణులను సంప్రదించండి.',
    alert_disease_red: '⚠️ *హెచ్చరిక:* ఎర్రటి శరీరం విబ్రియోసిస్‌ను సూచిస్తుంది. నీటి నాణ్యతను తనిఖీ చేయండి.',
    alert_disease_gut: '⚠️ *హెచ్చరిక:* తెల్లటి పేగు (White gut) కనిపించింది. మేతను తగ్గించి ప్రోబయోటిక్స్ వాడండి.',
    alert_growth_slow: '📉 *నెమ్మదిగా పెరుగుదల:* మేత నాణ్యత మరియు నీటి పారామితులను తనిఖీ చేయండి.',
    btn_update: 'అప్‌డేట్ చేయండి 📝',
    btn_weekly: 'వారపు నివేదిక 📋',
    label_fish_symptoms: 'చేపల లక్షణాలు',
    label_shrimp_symptoms: 'రొయ్యల లక్షణాలు',
    sym_no_signs: 'లక్షణాలు లేవు',
    sym_red_ulcer: 'ఎర్ర మచ్చలు / పుండ్లు',
    sym_dropsy: 'డ్రాప్సీ (ఉబ్బిన బొడ్డు)',
    sym_fin_rot: 'ఫిన్ / టెయిల్ రాట్',
    sym_argulus: 'చేపల పేలు (ఆర్గులస్)',
    sym_gasping: 'ఉపరితలం వద్ద గాలి పీల్చడం',
    sym_white_spots: 'తెల్ల మచ్చలు',
    sym_white_gut: 'వైట్ గట్ (తెల్లటి పేగు)',
    sym_red_body: 'ఎర్రటి శరీరం',
    sym_black_gills: 'నల్ల మొప్పలు',
    sym_muscle_cramps: 'కండరాల తిమ్మిరి',
    sym_other: 'ఇతర లక్షణాలు',
    q_feed_brand: '🍽️ మీరు ఏ బ్రాండ్ మేతను ఉపయోగిస్తున్నారు?',
    err_feed_brand: 'దయచేసి మీ మేత బ్రాండ్ పేరును టైప్ చేయండి.',
    q_feed_kg: '🍽️ నిన్న మీరు ఎన్ని కిలోల మేతను ఉపయోగించారు?',
    btn_lt10: '10 కిలోల కంటే తక్కువ',
    btn_10_30: '10–30 కిలోలు',
    btn_30_50: '30–50 కిలోలు',
    btn_50plus: '50 కిలోల కంటే ఎక్కువ',
    q_feed_times: '⏰ మీరు రోజుకు ఎన్ని సార్లు మేత వేస్తారు?',
    btn_1_time: '1 సారి',
    btn_2_times: '2 సార్లు',
    btn_3_4_times: '3-4 సార్లు',
    q_water_color: '🎨 ఈరోజు చెరువు నీటి రంగు ఏమిటి?',
    btn_color_green: '🟢 ఆకుపచ్చ',
    btn_color_dark_green: '🟤 ముదురు ఆకుపచ్చ',
    btn_color_brown_black: '🟫 గోధుమ/నలుపు',
    q_bad_smell: '👃 చెరువు నుండి ఏదైనా వాసన వస్తుందా?',
    btn_smell_no: 'లేదు',
    btn_smell_mild: 'అవును, తక్కువగా',
    btn_smell_strong: 'అవును, బలంగా',
    q_foam_bubbles: '🫧 అసాధారణమైన నురుగు లేదా బుడగలు ఉన్నాయా?',
    btn_yes: 'అవును',
    btn_no: 'లేదు',
    q_disease_signs: '🔬 మీ చెరువులో ఏదైనా వ్యాధి లక్షణాలు ఉన్నాయా?',
    btn_select_symptoms: 'లక్షణాలను ఎంచుకోండి',
    q_other_desc: '📝 దయచేసి మీరు చూస్తున్న ఇతర లక్షణాలను వివరించండి:',
    err_other_desc: 'దయచేసి మీరు చూస్తున్న లక్షణాలను టైప్ చేయండి.',
    q_growth_normal: '📈 మీ రొయ్యలు/చేపలు సాధారణంగా పెరుగుతున్నాయా?',
    btn_growth_yes: 'అవును, సాధారణంగా',
    btn_growth_slow: 'సాధారణం కంటే నెమ్మదిగా',
    btn_growth_unsure: 'ఖచ్చితంగా తెలియదు',
    greet_feed: '🍽️ *మేత చెక్-ఇన్*\nమేత గురించి చిన్న ప్రశ్నలు. కేవలం 30 సెకన్లలో ముగుస్తుంది!',
    greet_water: '💧 *నీటి చెక్-ఇన్*\nమీ చెరువు నీటిని తనిఖీ చేద్దాం. కేవలం 3 ట్యాప్‌లు!',
    greet_health: '🔬 *ఆరోగ్య చెక్-ఇన్*\nమీ చెరువు కోసం త్వరిత ఆరోగ్య తనిఖీ.',
    greet_default: '📋 చెక్-ఇన్ సమయం!',
    err_no_pond: '⚠️ చెరువు కనుగొనబడలేదు. దయచేసి ముందుగా సెటప్ పూర్తి చేయండి.'
  },
  Hindi: {
    recorded: 'दर्ज किया गया',
    feed_checkin: 'चारा चेक-इन',
    water_checkin: 'पानी चेक-इन',
    health_checkin: 'स्वास्थ्य चेक-इन',
    label_brand: 'ब्रांड',
    label_qty: 'मात्रा',
    label_freq: 'आवृत्ति',
    label_color: 'रंग',
    label_smell: 'गंध',
    label_foam: 'झाग',
    label_disease: 'बीमारी',
    label_growth: 'विकास',
    great_job: 'ट्रैक रखने के लिए बहुत अच्छा!',
    alert_feed_1x: '⚠️ *कार्रवाई की आवश्यकता:* दिन में केवल 1 बार चारा डालना बहुत कम है! आपकी मछली/झींगा ठीक से नहीं बढ़ेंगे। कृपया दिन में 3-4 बार चारा डालें।',
    alert_feed_2x: '💡 *सुझाव:* दिन में 3-4 बार चारा डालने पर विचार करें। अधिक बार कम भोजन देने से बेहतर विकास होता है।',
    alert_feed_low: '💡 चारे की मात्रा कम है लेकिन आवृत्ति अधिक है — जांचें कि क्या यह आपके स्टॉकिंग के लिए सही है।',
    alert_water_brown: '⚠️ *चेतावनी:* भूरा/काला पानी उच्च कार्बनिक कचरे को दर्शाता है। पानी बदलने पर विचार करें और वातन (aeration) बढ़ाएं।',
    alert_smell_strong: '🚨 *खतरा:* तेज गंध का मतलब है कि ऑक्सीजन कम है। तुरंत सभी एरेटर बढ़ा दें!',
    alert_smell_mild: '⚠️ *चेतावनी:* हल्की गंध। अपने ऑक्सीजन स्तर की बारीकी से निगरानी करें।',
    alert_foam: '⚠️ *चेतावनी:* असामान्य झाग का मतलब है अधिक जैविक कचरा। चारा थोड़ा कम करें।',
    alert_disease_white: '🚨 *आपातकाल:* सफेद धब्बे मिले! यह WSSV हो सकता है। तुरंत विशेषज्ञ से सलाह लें।',
    alert_disease_red: '⚠️ *चेतावनी:* लाल शरीर विब्रियोसिस का संकेत दे सकता है। पानी की गुणवत्ता की जांच करें।',
    alert_disease_gut: '⚠️ *चेतावनी:* सफेद आंत मिली। चारा कम करें और प्रोबायोटिक्स का उपयोग करें।',
    alert_growth_slow: '📉 *धीमी वृद्धि:* जांचें कि क्या चारे की गुणवत्ता अच्छी है और पानी स्थिर है।',
    btn_update: 'अभी अपडेट करें 📝',
    btn_weekly: 'साप्ताहिक रिपोर्ट 📋',
    label_fish_symptoms: 'मछली के लक्षण',
    label_shrimp_symptoms: 'झींगा के लक्षण',
    sym_no_signs: 'कोई लक्षण नहीं',
    sym_red_ulcer: 'लाल धब्बे / अल्सर',
    sym_dropsy: 'ड्रॉप्सी (सूजा हुआ पेट)',
    sym_fin_rot: 'पूंछ/पंख सड़ना',
    sym_argulus: 'फिश लाइस (आर्गुलस)',
    sym_gasping: 'सतह पर हांफना',
    sym_white_spots: 'सफेद धब्बे',
    sym_white_gut: 'सफेद आंत',
    sym_red_body: 'लाल शरीर',
    sym_black_gills: 'काले गलफड़े',
    sym_muscle_cramps: 'मांसपेशियों में ऐंठन',
    sym_other: 'अन्य लक्षण',
    q_feed_brand: '🍽️ आप कौन सा फीड ब्रांड उपयोग कर रहे हैं?',
    err_feed_brand: 'कृपया अपने फीड ब्रांड का नाम टाइप करें।',
    q_feed_kg: '🍽️ आपने कल कितने किलो चारा उपयोग किया?',
    btn_lt10: '10 किलो से कम',
    btn_10_30: '10–30 किलो',
    btn_30_50: '30–50 किलो',
    btn_50plus: '50 किलो से अधिक',
    q_feed_times: '⏰ आप दिन में कितनी बार चारा डालते हैं?',
    btn_1_time: '1 बार',
    btn_2_times: '2 बार',
    btn_3_4_times: '3-4 बार',
    q_water_color: '🎨 आज तालाब के पानी का रंग क्या है?',
    btn_color_green: '🟢 हरा',
    btn_color_dark_green: '🟤 गहरा हरा',
    btn_color_brown_black: '🟫 भूरा/काला',
    q_bad_smell: '👃 क्या तालाब से कोई गंध आ रही है?',
    btn_smell_no: 'नहीं',
    btn_smell_mild: 'हाँ, हल्की',
    btn_smell_strong: 'हाँ, तेज़',
    q_foam_bubbles: '🫧 क्या कोई असामान्य झाग या बुलबुले हैं?',
    btn_yes: 'हाँ',
    btn_no: 'नहीं',
    q_disease_signs: '🔬 क्या आपके तालाब में कोई बीमारी के लक्षण हैं?',
    btn_select_symptoms: 'लक्षण चुनें',
    q_other_desc: '📝 कृपया उन अन्य लक्षणों का वर्णन करें जिन्हें आप देख रहे हैं:',
    err_other_desc: 'कृपया वे लक्षण टाइप करें जिन्हें आप देख रहे हैं।',
    q_growth_normal: '📈 क्या आपकी झींगा/मछली सामान्य रूप से बढ़ रही है?',
    btn_growth_yes: 'हाँ, सामान्य',
    btn_growth_slow: 'हमेशा से धीमी',
    btn_growth_unsure: 'निश्चित नहीं',
    greet_feed: '🍽️ *फीड चेक-इन*\nचारे के बारे में छोटे सवाल। बस 30 सेकंड में!',
    greet_water: '💧 *पानी चेक-इन*\nआइए आपके तालाब के पानी की जाँच करें। बस 3 टैप!',
    greet_health: '🔬 *स्वास्थ्य चेक-इन*\nआपके तालाब के लिए त्वरित स्वास्थ्य जांच।',
    greet_default: '📋 चेक-इन का समय!',
    err_no_pond: '⚠️ कोई तालाब नहीं मिला। कृपया पहले सेटअप पूरा करें।'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

function formatLogSummary(logGroup, data, lang = 'English') {
  if (logGroup === 'feed') {
    let msg = '';
    if (data.feed_brand) msg += `🏷️ ${t('label_brand', lang)}: ${data.feed_brand}\n`;
    if (data.feed_kg) msg += `📦 ${t('label_qty', lang)}: ${data.feed_kg} kg\n`;
    if (data.feed_times) msg += `⏰ ${t('label_freq', lang)}: ${data.feed_times}x/day\n`;
    return msg;
  }
  if (logGroup === 'water') {
    let msg = '';
    if (data.water_color) msg += `🎨 ${t('label_color', lang)}: ${data.water_color}\n`;
    if (data.bad_smell) msg += `👃 ${t('label_smell', lang)}: ${data.bad_smell}\n`;
    if (data.foam_bubbles) msg += `🫧 ${t('label_foam', lang)}: ${data.foam_bubbles}\n`;
    return msg;
  }
  if (logGroup === 'health') {
    let msg = '';
    if (data.disease_signs) msg += `🔬 ${t('label_disease', lang)}: ${data.disease_signs}\n`;
    if (data.growth_status) msg += `📈 ${t('label_growth', lang)}: ${data.growth_status}\n`;
    return msg;
  }
  return JSON.stringify(data);
}

/**
 * Get which check-in type should run today based on day of week
 */
function getTodayCheckInType() {
  const day = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (day === 1) return 'daily_feed';     // Monday
  if (day === 3) return 'daily_water';    // Wednesday
  if (day === 5) return 'daily_health';   // Friday
  return null; // No check-in on other days
}

module.exports = {
  startDailyCheckIn,
  handleDailyStep,
  getTodayCheckInType,
  GROUP_MAP,
  translations,
  t
};
