const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { getFirstPondByFarmer, insertPondLog, saveChatHistory } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');
const { calculateHealthScore } = require('./healthScore');

/**
 * Weekly Check-In — Every Sunday
 *
 * 4 quick questions (NO mortality — only handled if user reports it):
 * 1. Any disease signs? (buttons)
 * 2. Feed quantity used this week? (buttons)
 * 3. Any unusual water changes? (buttons)
 * 4. Are shrimp/fish growing normally? (buttons)
 */

const WEEKLY_STEPS = [
  {
    key: 'disease_signs',
    prompt: '🔬 Any disease signs this week?',
    buttons: [
      { id: 'wk_disease_no', title: 'No' },
      { id: 'wk_disease_yes', title: 'Yes' },
    ],
    parseButton: (input) => {
      if (input === 'no' || input === 'wk_disease_no') return 'no';
      if (input === 'yes' || input === 'wk_disease_yes') return 'yes';
      return null;
    },
  },
  {
    key: 'feed_used',
    prompt: '🍽️ How much feed did you use this week?',
    buttons: [
      { id: 'wk_feed_low', title: 'Less than 50 kg' },
      { id: 'wk_feed_mid', title: '50–100 kg' },
      { id: 'wk_feed_high', title: '100+ kg' },
    ],
    parseButton: (input) => {
      if (input.includes('less') || input.includes('50') && !input.includes('100') || input === 'wk_feed_low') return '<50';
      if (input.includes('100') || input === 'wk_feed_high') return '100+';
      if (input.includes('50') || input === 'wk_feed_mid') return '50-100';
      return null;
    },
  },
  {
    key: 'water_changes',
    prompt: '💧 Any unusual water changes this week?',
    buttons: [
      { id: 'wk_water_no', title: 'No change' },
      { id: 'wk_water_color', title: 'Color changed' },
      { id: 'wk_water_smell', title: 'Bad smell/foam' },
    ],
    parseButton: (input) => {
      if (input.includes('no') || input === 'wk_water_no') return 'no_change';
      if (input.includes('color') || input === 'wk_water_color') return 'color_changed';
      if (input.includes('smell') || input.includes('foam') || input === 'wk_water_smell') return 'smell_foam';
      if (input.includes('low') || input.includes('level')) return 'low_water';
      return null;
    },
  },
  {
    key: 'growth_status',
    prompt: '📈 Are your shrimp/fish growing normally this week?',
    buttons: [
      { id: 'wk_growth_yes', title: 'Yes, normal' },
      { id: 'wk_growth_slow', title: 'Slower than usual' },
      { id: 'wk_growth_unsure', title: 'Not sure' },
    ],
    parseButton: (input) => {
      if (input === 'yes' || input.includes('normal') || input === 'wk_growth_yes') return 'normal';
      if (input.includes('slow') || input === 'wk_growth_slow') return 'slow';
      if (input.includes('not sure') || input.includes('unsure') || input === 'wk_growth_unsure') return 'not_sure';
      return null;
    },
  },
];

// ========================
// START WEEKLY CHECK-IN
// ========================

async function startWeeklyCheckIn(phone, farmerId) {
  const pond = await getFirstPondByFarmer(farmerId);
  if (!pond) {
    await sendTextMessage(phone, '⚠️ No pond found. Please complete setup first.');
    return;
  }

  setState(phone, {
    flow: 'weekly_checkin',
    step: 0,
    data: {},
    farmerId,
    pondId: pond.id,
  });

  await sendTextMessage(phone,
    '📋 *Weekly Check-In*\n\nQuick 4-question weekly summary. Takes 1 minute! ⏱️'
  );

  await askWeeklyQuestion(phone);
}

// ========================
// HANDLE STEP
// ========================

async function handleWeeklyStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'weekly_checkin') return false;

  const stepIndex = state.step;
  if (stepIndex >= WEEKLY_STEPS.length) return false;

  const stepDef = WEEKLY_STEPS[stepIndex];
  const input = message.toLowerCase().trim();

  const value = stepDef.parseButton(input);
  if (!value) {
    await askWeeklyQuestion(phone);
    return true;
  }

  updateStateData(phone, { [stepDef.key]: value });

  const updatedState = getState(phone);
  if (updatedState.step >= WEEKLY_STEPS.length) {
    await finalizeWeeklyCheckIn(phone);
    return true;
  }

  await askWeeklyQuestion(phone);
  return true;
}

// ========================
// ASK QUESTION
// ========================

async function askWeeklyQuestion(phone) {
  const state = getState(phone);
  const stepIndex = state.step;
  if (stepIndex >= WEEKLY_STEPS.length) return;

  const stepDef = WEEKLY_STEPS[stepIndex];
  await sendButtonMessage(phone, stepDef.prompt, stepDef.buttons);
}

// ========================
// FINALIZE
// ========================

async function finalizeWeeklyCheckIn(phone) {
  const state = getState(phone);
  const data = state.data;

  // Save to pond_logs
  await insertPondLog({
    pond_id: state.pondId,
    log_group: 'weekly',
    log_data: data,
  });

  // Recalculate health score
  try {
    await calculateHealthScore(state.pondId);
  } catch (err) {
    console.warn('⚠️ Health score calculation failed:', err.message);
  }

  clearState(phone);

  // Build confirmation
  let confirmMsg = '✅ *Weekly report saved!*\n\n';
  confirmMsg += `🔬 Disease signs: ${data.disease_signs}\n`;
  confirmMsg += `🍽️ Feed used: ${data.feed_used} kg\n`;
  confirmMsg += `💧 Water: ${data.water_changes}\n`;
  confirmMsg += `📈 Growth: ${data.growth_status}\n`;

  // Alerts
  const alerts = [];
  if (data.disease_signs === 'yes') alerts.push('⚠️ Disease signs detected! Send a photo for analysis or describe symptoms.');
  if (data.water_changes === 'color_changed') alerts.push('⚠️ Water color change — monitor DO and consider partial water exchange.');
  if (data.water_changes === 'smell_foam') alerts.push('⚠️ Bad smell/foam indicates low oxygen. Increase aeration!');
  if (data.growth_status === 'slow') alerts.push('📉 Slow growth — check feed quality and water parameters.');

  if (alerts.length > 0) {
    confirmMsg += `\n${alerts.join('\n')}`;
  }

  confirmMsg += '\n\nGreat weekly update! Keep it up! 📊';

  // Save to chat history so AI remembers weekly data
  try {
    const summaryMsg = `[Weekly Check-In] disease=${data.disease_signs}, feed=${data.feed_used}kg, water=${data.water_changes}, growth=${data.growth_status}`;
    await saveChatHistory({
      farmer_id: state.farmerId,
      message: summaryMsg,
      response: confirmMsg,
      message_type: 'checkin',
    });
  } catch (err) {
    console.warn('⚠️ Could not save weekly check-in to chat history:', err.message);
  }

  await sendTextMessage(phone, confirmMsg);
}

module.exports = {
  startWeeklyCheckIn,
  handleWeeklyStep,
};
