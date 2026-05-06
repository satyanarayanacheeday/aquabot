const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, updatePond, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { calculateHealthScore } = require('./healthScore');
const productEngine = require('./productEngine');

/**
 * Daily Check-In — Rotating Groups
 *
 * Monday   → Feed Group (3 questions)
 * Wednesday → Water Group (3 questions)
 * Friday   → Health Group (2 questions — NO proactive mortality question)
 *
 * All questions use button-tap input. Farmers never type long answers.
 */

// ========================
// FEED GROUP (Monday)
// ========================

const FEED_STEPS = [
  {
    key: 'feed_brand',
    askOnce: true, // only ask first time, then skip
    prompt: '🍽️ What feed brand are you using?',
    type: 'text', // free text — only exception
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: 'Please type your feed brand name.',
  },
  {
    key: 'feed_kg',
    prompt: '🍽️ How many kg of feed did you use yesterday?',
    buttons: [
      { id: 'feed_lt10', title: 'Less than 10 kg' },
      { id: 'feed_10_30', title: '10–30 kg' },
      { id: 'feed_30_50', title: '30–50 kg' },
    ],
    parseButton: (input) => {
      if (input.includes('less') || input.includes('10') && !input.includes('30') || input === 'feed_lt10') return '<10';
      if (input.includes('10') && input.includes('30') || input === 'feed_10_30') return '10-30';
      if (input.includes('30') && input.includes('50') || input === 'feed_30_50') return '30-50';
      if (input.includes('50') || input === 'feed_50plus') return '50+';
      return null;
    },
  },
  {
    key: 'feed_times',
    prompt: '⏰ How many times do you feed per day?',
    buttons: [
      { id: 'times_1', title: '1 time' },
      { id: 'times_2', title: '2 times' },
      { id: 'times_3', title: '3-4 times' },
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
    prompt: '🎨 What is the pond water color today?',
    buttons: [
      { id: 'color_green', title: '🟢 Green' },
      { id: 'color_dkgreen', title: '🟤 Dark Green' },
      { id: 'color_brown', title: '🟫 Brown/Black' },
    ],
    parseButton: (input) => {
      if (input.includes('green') && !input.includes('dark') || input === 'color_green') return 'green';
      if (input.includes('dark') || input === 'color_dkgreen') return 'dark_green';
      if (input.includes('brown') || input.includes('black') || input === 'color_brown') return 'brown_black';
      if (input.includes('clear') || input === 'color_clear') return 'clear';
      return null;
    },
  },
  {
    key: 'bad_smell',
    prompt: '👃 Any bad smell from the pond?',
    buttons: [
      { id: 'smell_no', title: 'No' },
      { id: 'smell_mild', title: 'Yes, mild' },
      { id: 'smell_strong', title: 'Yes, strong' },
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
    prompt: '🫧 Any unusual foam or bubbles?',
    buttons: [
      { id: 'foam_no', title: 'No' },
      { id: 'foam_yes', title: 'Yes' },
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
    prompt: '🔬 Any disease signs in your pond?',
    buttons: [
      { id: 'disease_no', title: 'No signs' },
      { id: 'disease_spots', title: 'White spots' },
      { id: 'disease_other', title: 'Other signs' },
    ],
    parseButton: (input) => {
      if (input === 'no' || input.includes('no sign') || input === 'disease_no') return 'none';
      if (input.includes('white') || input.includes('spot') || input === 'disease_spots') return 'white_spots';
      if (input.includes('red') || input === 'disease_red') return 'red_body';
      if (input.includes('gut') || input.includes('white gut') || input === 'disease_gut') return 'white_gut';
      if (input.includes('slow') || input.includes('eating') || input === 'disease_eating') return 'slow_eating';
      if (input.includes('other') || input === 'disease_other') return 'other';
      return null;
    },
  },
  {
    key: 'growth_status',
    prompt: '📈 Are your shrimp/fish growing normally?',
    buttons: [
      { id: 'growth_yes', title: 'Yes, normal' },
      { id: 'growth_slow', title: 'Slower than usual' },
      { id: 'growth_unsure', title: 'Not sure' },
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

  const pond = await getFirstPondByFarmer(farmerId);
  if (!pond) {
    await sendTextMessage(phone, '⚠️ No pond found. Please complete setup first.');
    return;
  }

  // For feed group: skip feed_brand if already saved
  let startStep = 0;
  if (groupType === 'daily_feed' && pond.feed_brand) {
    startStep = 1; // skip brand question
  }

  setState(phone, {
    flow: groupType,
    step: startStep,
    data: {},
    farmerId,
    pondId: pond.id,
  });

  const greeting = getCheckInGreeting(groupType);
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
    if (!stepDef.validate(message)) {
      await sendTextMessage(phone, stepDef.errorMsg);
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

  // Check if all steps done
  const updatedState = getState(phone);
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

  if (stepDef.type === 'text') {
    await sendTextMessage(phone, stepDef.prompt);
  } else {
    await sendButtonMessage(phone, stepDef.prompt, stepDef.buttons);
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

  confirmMsg += `\n\n${t('great_job', lang)} 🎯`;

  // Save to chat history so AI remembers check-in data
  try {
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

function getCheckInGreeting(groupType) {
  if (groupType === 'daily_feed') return '🍽️ *Feed Check-In*\nQuick questions about feeding. Takes 30 seconds!';
  if (groupType === 'daily_water') return '💧 *Water Check-In*\nLet\'s check your pond water. Just 3 taps!';
  if (groupType === 'daily_health') return '🔬 *Health Check-In*\nQuick health check for your pond.';
  return '📋 Check-in time!';
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
    btn_weekly: 'Weekly Report 📋'
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
    btn_weekly: 'వారపు నివేదిక 📋'
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
    btn_weekly: 'साप्ताहिक रिपोर्ट 📋'
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
  translations
};
