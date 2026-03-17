const { sendTextMessage } = require('./whatsapp');
const { insertDailyData, insertGrowthData, getFirstFarmByFarmer } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

// ========================
// DAILY POND DATA COLLECTION
// ========================

const DAILY_STEPS = [
  {
    key: 'dissolved_oxygen',
    prompt: '🫧 *Dissolved Oxygen (DO)* — What is the DO level? (mg/L)\n\nExample: _4.5_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0 && num <= 20;
    },
    errorMsg: 'Please enter a valid DO value (0-20 mg/L). Example: 4.5',
    transform: (v) => parseFloat(v),
  },
  {
    key: 'ph',
    prompt: '🧪 *pH Level* — What is the pH? \n\nExample: _8.1_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0 && num <= 14;
    },
    errorMsg: 'Please enter a valid pH value (0-14). Example: 8.1',
    transform: (v) => parseFloat(v),
  },
  {
    key: 'feed_amount',
    prompt: '🍽️ *Feed Given Today* — How many kg of feed? \n\nExample: _30_',
    validate: (v) => {
      const cleaned = v.replace(/kg/gi, '').trim();
      const num = parseFloat(cleaned);
      return !isNaN(num) && num >= 0;
    },
    errorMsg: 'Please enter a valid feed amount in kg. Example: 30',
    transform: (v) => parseFloat(v.replace(/kg/gi, '').trim()),
  },
];

async function startDailyCollection(phone, farmerId) {
  const farm = await getFirstFarmByFarmer(farmerId);
  if (!farm) {
    await sendTextMessage(phone, '⚠️ No farm found. Please complete registration first.');
    return;
  }

  setState(phone, {
    flow: 'daily_data',
    step: 0,
    data: {},
    farmerId,
    farmId: farm.id,
  });

  await sendTextMessage(phone,
    `Good morning ☀️\n\nTime to update today's pond data.\nI'll ask 3 quick questions.`
  );

  await sendTextMessage(phone, DAILY_STEPS[0].prompt);
}

async function handleDailyStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'daily_data') return false;

  const stepIndex = state.step;
  if (stepIndex >= DAILY_STEPS.length) return false;

  const stepDef = DAILY_STEPS[stepIndex];
  const value = message.trim();

  if (!stepDef.validate(value)) {
    await sendTextMessage(phone, stepDef.errorMsg);
    return true;
  }

  const transformedValue = stepDef.transform(value);
  updateStateData(phone, { [stepDef.key]: transformedValue });

  const updatedState = getState(phone);

  // Check if all steps done
  if (updatedState.step >= DAILY_STEPS.length) {
    await finalizeDailyData(phone);
    return true;
  }

  // Ask next question
  await sendTextMessage(phone, DAILY_STEPS[updatedState.step].prompt);
  return true;
}

async function finalizeDailyData(phone) {
  const state = getState(phone);
  const data = state.data;

  await insertDailyData({
    farm_id: state.farmId,
    dissolved_oxygen: data.dissolved_oxygen,
    ph: data.ph,
    feed_amount: data.feed_amount,
  });

  clearState(phone);

  let alerts = [];
  if (data.dissolved_oxygen < 4) alerts.push('⚠️ DO is low! Consider turning on aerators.');
  if (data.ph < 7.5 || data.ph > 8.5) alerts.push('⚠️ pH is outside ideal range (7.5–8.5).');

  let confirmMsg =
    `✅ *Daily data recorded!*\n\n` +
    `🫧 DO: ${data.dissolved_oxygen} mg/L\n` +
    `🧪 pH: ${data.ph}\n` +
    `🍽️ Feed: ${data.feed_amount} kg`;

  if (alerts.length > 0) {
    confirmMsg += `\n\n${alerts.join('\n')}`;
  }

  confirmMsg += `\n\nGreat job keeping track! 🎯`;

  await sendTextMessage(phone, confirmMsg);
}

// ========================
// WEEKLY SAMPLING DATA COLLECTION
// ========================

const WEEKLY_STEPS = [
  {
    key: 'avg_weight',
    prompt: '⚖️ *Average Weight* — What is the average shrimp/fish weight? (grams)\n\nExample: _7_',
    validate: (v) => {
      const cleaned = v.replace(/g|grams?/gi, '').trim();
      const num = parseFloat(cleaned);
      return !isNaN(num) && num > 0;
    },
    errorMsg: 'Please enter a valid weight in grams. Example: 7',
    transform: (v) => parseFloat(v.replace(/g|grams?/gi, '').trim()),
  },
  {
    key: 'survival_rate',
    prompt: '📊 *Survival Estimate* — What is the estimated survival rate? (%)\n\nExample: _85_',
    validate: (v) => {
      const cleaned = v.replace(/%/g, '').trim();
      const num = parseFloat(cleaned);
      return !isNaN(num) && num >= 0 && num <= 100;
    },
    errorMsg: 'Please enter a valid percentage (0-100). Example: 85',
    transform: (v) => parseFloat(v.replace(/%/g, '').trim()),
  },
  {
    key: 'water_color',
    prompt: '🎨 *Water Color* — What color is the pond water?\n\nExamples: _green_, _brown_, _clear_, _dark green_',
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: 'Please describe the water color. Example: green',
  },
  {
    key: 'ammonia',
    prompt: '🧪 *Ammonia (NH3/NH4)* — What is the ammonia level? (mg/L)\n\nExample: _0.25_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0 && num <= 10;
    },
    errorMsg: 'Please enter a valid ammonia level (0-10 mg/L). Example: 0.25',
    transform: (v) => parseFloat(v),
  },
  {
    key: 'nitrite',
    prompt: '🧪 *Nitrite (NO2)* — What is the nitrite level? (mg/L)\n\nExample: _0.1_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0 && num <= 10;
    },
    errorMsg: 'Please enter a valid nitrite level (0-10 mg/L). Example: 0.1',
    transform: (v) => parseFloat(v),
  },
  {
    key: 'alkalinity',
    prompt: '🧪 *Alkalinity* — What is the alkalinity? (ppm)\n\nExample: _120_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0;
    },
    errorMsg: 'Please enter a valid alkalinity in ppm. Example: 120',
    transform: (v) => parseFloat(v),
  },
  {
    key: 'hardness',
    prompt: '🧪 *Hardness* — What is the water hardness? (ppm)\n\nExample: _300_',
    validate: (v) => {
      const num = parseFloat(v);
      return !isNaN(num) && num >= 0;
    },
    errorMsg: 'Please enter a valid hardness in ppm. Example: 300',
    transform: (v) => parseFloat(v),
  },
];

async function startWeeklyCollection(phone, farmerId) {
  const farm = await getFirstFarmByFarmer(farmerId);
  if (!farm) {
    await sendTextMessage(phone, '⚠️ No farm found. Please complete registration first.');
    return;
  }

  setState(phone, {
    flow: 'weekly_data',
    step: 0,
    data: {},
    farmerId,
    farmId: farm.id,
  });

  await sendTextMessage(phone,
    `📋 *Weekly Water & Growth Report*\n\nTime for your weekly report!\nI'll ask some questions about growth and water quality.`
  );

  await sendTextMessage(phone, WEEKLY_STEPS[0].prompt);
}

async function handleWeeklyStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'weekly_data') return false;

  const stepIndex = state.step;
  if (stepIndex >= WEEKLY_STEPS.length) return false;

  const stepDef = WEEKLY_STEPS[stepIndex];
  const value = message.trim();

  if (!stepDef.validate(value)) {
    await sendTextMessage(phone, stepDef.errorMsg);
    return true;
  }

  const transformedValue = stepDef.transform ? stepDef.transform(value) : value.trim();
  updateStateData(phone, { [stepDef.key]: transformedValue });

  const updatedState = getState(phone);

  if (updatedState.step >= WEEKLY_STEPS.length) {
    await finalizeWeeklyData(phone);
    return true;
  }

  await sendTextMessage(phone, WEEKLY_STEPS[updatedState.step].prompt);
  return true;
}

async function finalizeWeeklyData(phone) {
  const state = getState(phone);
  const data = state.data;

  await insertGrowthData({
    farm_id: state.farmId,
    avg_weight: data.avg_weight,
    survival_rate: data.survival_rate,
    water_color: data.water_color,
    ammonia: data.ammonia,
    nitrite: data.nitrite,
    alkalinity: data.alkalinity,
    hardness: data.hardness,
  });

  clearState(phone);

  let alerts = [];
  if (data.ammonia > 0.5) alerts.push('⚠️ Ammonia is high! Increase aeration and reduce feeding.');
  if (data.nitrite > 1.0) alerts.push('⚠️ Nitrite is high! Consider water exchange if possible.');

  let confirmMsg =
    `✅ *Weekly sampling saved!*\n\n` +
    `⚖️ Weight: ${data.avg_weight}g\n` +
    `📊 Survival: ${data.survival_rate}%\n` +
    `🎨 Color: ${data.water_color}\n` +
    `🧪 Ammonia: ${data.ammonia} mg/L\n` +
    `🧪 Nitrite: ${data.nitrite} mg/L\n` +
    `🧪 Alkalinity: ${data.alkalinity} ppm\n` +
    `🧪 Hardness: ${data.hardness} ppm`;

  if (alerts.length > 0) {
    confirmMsg += `\n\n${alerts.join('\n')}`;
  }

  confirmMsg += `\n\nWeekly report complete! 📈`;

  await sendTextMessage(phone, confirmMsg);
}

module.exports = {
  startDailyCollection,
  handleDailyStep,
  startWeeklyCollection,
  handleWeeklyStep,
};
