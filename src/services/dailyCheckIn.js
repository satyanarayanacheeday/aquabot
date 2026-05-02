const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, updatePond, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { calculateHealthScore } = require('./healthScore');

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
  let confirmMsg = `✅ *${config.label} recorded!*\n\n`;
  confirmMsg += formatLogSummary(config.logGroup, data);

  // Add alerts
  const alerts = generateAlerts(config.logGroup, data);
  if (alerts.length > 0) {
    confirmMsg += `\n\n${alerts.join('\n')}`;
  }

  confirmMsg += `\n\nGreat job keeping track! 🎯`;

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

function formatLogSummary(logGroup, data) {
  if (logGroup === 'feed') {
    let msg = '';
    if (data.feed_brand) msg += `🏷️ Brand: ${data.feed_brand}\n`;
    if (data.feed_kg) msg += `📦 Quantity: ${data.feed_kg} kg\n`;
    if (data.feed_times) msg += `⏰ Frequency: ${data.feed_times}x/day\n`;
    return msg;
  }
  if (logGroup === 'water') {
    let msg = '';
    if (data.water_color) msg += `🎨 Color: ${data.water_color}\n`;
    if (data.bad_smell) msg += `👃 Smell: ${data.bad_smell}\n`;
    if (data.foam_bubbles) msg += `🫧 Foam: ${data.foam_bubbles}\n`;
    return msg;
  }
  if (logGroup === 'health') {
    let msg = '';
    if (data.disease_signs) msg += `🔬 Disease: ${data.disease_signs}\n`;
    if (data.growth_status) msg += `📈 Growth: ${data.growth_status}\n`;
    return msg;
  }
  return JSON.stringify(data);
}

function generateAlerts(logGroup, data) {
  const alerts = [];

  if (logGroup === 'water') {
    if (data.water_color === 'brown_black') alerts.push('⚠️ Brown/black water indicates poor conditions. Consider water exchange.');
    if (data.bad_smell === 'strong') alerts.push('⚠️ Strong smell = low oxygen. Increase aeration immediately!');
    if (data.foam_bubbles === 'yes') alerts.push('⚠️ Foam/bubbles may indicate excess organic matter. Monitor closely.');
  }

  if (logGroup === 'health') {
    if (data.disease_signs === 'white_spots') alerts.push('🚨 White spots detected! This may indicate WSSV. Consult an expert immediately.');
    if (data.disease_signs === 'red_body') alerts.push('⚠️ Red body may indicate Vibriosis. Maintain water quality and consult expert.');
    if (data.disease_signs === 'white_gut') alerts.push('⚠️ White gut may indicate EHP. Reduce feed by 30-50% and add probiotics.');
    if (data.growth_status === 'slow') alerts.push('📉 Slow growth? Check feed quality, water parameters, and stocking density.');
  }

  if (logGroup === 'feed') {
    if (data.feed_kg === '<10' && data.feed_times >= 3) alerts.push('💡 Low feed amount with high frequency — verify this is correct for your stocking density.');
  }

  return alerts;
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
};
