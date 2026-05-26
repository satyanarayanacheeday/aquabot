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
    prompt: (lang) => t('q_wk_disease', lang),
    buttons: (lang) => [
      { id: 'wk_disease_no', title: t('btn_no', lang) },
      { id: 'wk_disease_yes', title: t('btn_yes', lang) },
    ],
    parseButton: (input) => {
      if (input === 'no' || input === 'wk_disease_no') return 'no';
      if (input === 'yes' || input === 'wk_disease_yes') return 'yes';
      return null;
    },
  },
  {
    key: 'feed_used',
    prompt: (lang) => t('q_wk_feed', lang),
    buttons: (lang) => [
      { id: 'wk_feed_low', title: t('btn_wk_lt50', lang) },
      { id: 'wk_feed_mid', title: t('btn_wk_50_100', lang) },
      { id: 'wk_feed_high', title: t('btn_wk_100plus', lang) },
    ],
    parseButton: (input) => {
      if (input.includes('less') || (input.includes('50') && !input.includes('100')) || input === 'wk_feed_low') return '<50';
      if (input.includes('100') || input === 'wk_feed_high') return '100+';
      if (input.includes('50') || input === 'wk_feed_mid') return '50-100';
      return null;
    },
  },
  {
    key: 'water_changes',
    prompt: (lang) => t('q_wk_water', lang),
    buttons: (lang) => [
      { id: 'wk_water_no', title: t('btn_no_change', lang) },
      { id: 'wk_water_color', title: t('btn_color_changed', lang) },
      { id: 'wk_water_smell', title: t('btn_bad_smell_foam', lang) },
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
    prompt: (lang) => t('q_wk_growth', lang),
    buttons: (lang) => [
      { id: 'wk_growth_yes', title: t('btn_growth_yes', lang) },
      { id: 'wk_growth_slow', title: t('btn_growth_slow', lang) },
      { id: 'wk_growth_unsure', title: t('btn_growth_unsure', lang) },
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
  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(farmerId);
  const lang = farmer?.preferred_language || 'English';

  const pond = await getFirstPondByFarmer(farmerId);
  if (!pond) {
    await sendTextMessage(phone, t('err_no_pond', lang));
    return;
  }

  setState(phone, {
    flow: 'weekly_checkin',
    step: 0,
    data: {},
    farmerId,
    pondId: pond.id,
  });

  await sendTextMessage(phone, t('greet_weekly_checkin', lang));
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

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

  const stepDef = WEEKLY_STEPS[stepIndex];
  const prompt = typeof stepDef.prompt === 'function' ? stepDef.prompt(lang) : stepDef.prompt;
  const buttons = typeof stepDef.buttons === 'function' ? stepDef.buttons(lang) : stepDef.buttons;

  await sendButtonMessage(phone, prompt, buttons);
}

// ========================
// FINALIZE
// ========================

async function finalizeWeeklyCheckIn(phone) {
  const state = getState(phone);
  const data = state.data;

  const { getFarmerById } = require('../models/database');
  const farmer = await getFarmerById(state.farmerId);
  const lang = farmer?.preferred_language || 'English';

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
  let confirmMsg = t('msg_weekly_saved', lang);
  confirmMsg += `${t('label_disease_signs', lang)}: ${data.disease_signs}\n`;
  confirmMsg += `${t('label_feed_used', lang)}: ${data.feed_used} kg\n`;
  confirmMsg += `${t('label_water', lang)}: ${data.water_changes}\n`;
  confirmMsg += `${t('label_growth', lang)}: ${data.growth_status}\n`;

  // Alerts
  const alerts = [];
  if (data.disease_signs === 'yes') alerts.push(t('alert_disease_yes', lang));
  if (data.water_changes === 'color_changed') alerts.push(t('alert_water_color', lang));
  if (data.water_changes === 'smell_foam') alerts.push(t('alert_water_smell', lang));
  if (data.growth_status === 'slow') alerts.push(t('alert_growth_slow', lang));

  if (alerts.length > 0) {
    confirmMsg += `\n${alerts.join('\n')}`;
  }

  confirmMsg += t('msg_weekly_footer', lang);

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

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    q_wk_disease: '🔬 Any disease signs this week?',
    btn_yes: 'Yes',
    btn_no: 'No',
    q_wk_feed: '🍽️ How much feed did you use this week?',
    btn_wk_lt50: 'Less than 50 kg',
    btn_wk_50_100: '50–100 kg',
    btn_wk_100plus: '100+ kg',
    q_wk_water: '💧 Any unusual water changes this week?',
    btn_no_change: 'No change',
    btn_color_changed: 'Color changed',
    btn_bad_smell_foam: 'Bad smell/foam',
    q_wk_growth: '📈 Are your shrimp/fish growing normally this week?',
    btn_growth_yes: 'Yes, normal',
    btn_growth_slow: 'Slower than usual',
    btn_growth_unsure: 'Not sure',
    err_no_pond: '⚠️ No pond found. Please complete setup first.',
    greet_weekly_checkin: '📋 *Weekly Check-In*\n\nQuick 4-question weekly summary. Takes 1 minute! ⏱️',
    msg_weekly_saved: '✅ *Weekly report saved!*\n\n',
    label_disease_signs: '🔬 Disease signs',
    label_feed_used: '🍽️ Feed used',
    label_water: '💧 Water',
    label_growth: '📈 Growth',
    alert_disease_yes: '⚠️ Disease signs detected! Send a photo for analysis or describe symptoms.',
    alert_water_color: '⚠️ Water color change — monitor DO and consider partial water exchange.',
    alert_water_smell: '⚠️ Bad smell/foam indicates low oxygen. Increase aeration!',
    alert_growth_slow: '📉 Slow growth — check feed quality and water parameters.',
    msg_weekly_footer: '\n\nGreat weekly update! Keep it up! 📊'
  },
  Telugu: {
    q_wk_disease: '🔬 ఈ వారం ఏదైనా వ్యాధి లక్షణాలు ఉన్నాయా?',
    btn_yes: 'అవును',
    btn_no: 'లేదు',
    q_wk_feed: '🍽️ ఈ వారం మీరు ఎంత మేతను ఉపయోగించారు?',
    btn_wk_lt50: '50 కిలోల కంటే తక్కువ',
    btn_wk_50_100: '50–100 కిలోలు',
    btn_wk_100plus: '100+ కిలోలు',
    q_wk_water: '💧 ఈ వారం నీటిలో ఏదైనా అసాధారణ మార్పులు ఉన్నాయా?',
    btn_no_change: 'మార్పు లేదు',
    btn_color_changed: 'రంగు మారింది',
    btn_bad_smell_foam: 'చెడు వాసన/నురుగు',
    q_wk_growth: '📈 మీ రొయ్యలు/చేపలు ఈ వారం సాధారణంగా పెరుగుతున్నాయా?',
    btn_growth_yes: 'అవును, సాధారణంగా',
    btn_growth_slow: 'సాధారణం కంటే నెమ్మదిగా',
    btn_growth_unsure: 'ఖచ్చితంగా తెలియదు',
    err_no_pond: '⚠️ చెరువు కనుగొనబడలేదు. దయచేసి ముందుగా సెటప్ పూర్తి చేయండి.',
    greet_weekly_checkin: '📋 *వారపు చెక్-ఇన్*\n\nత్వరిత 4-ప్రశ్నల వారపు సారాంశం. కేవలం 1 నిమిషం పడుతుంది! ⏱️',
    msg_weekly_saved: '✅ *వారపు నివేదిక సేవ్ చేయబడింది!*\n\n',
    label_disease_signs: '🔬 వ్యాధి లక్షణాలు',
    label_feed_used: '🍽️ ఉపయోగించిన మేత',
    label_water: '💧 నీరు',
    label_growth: '📈 పెరుగుదల',
    alert_disease_yes: '⚠️ వ్యాధి లక్షణాలు కనిపించాయి! విశ్లేషణ కోసం ఫోటో పంపండి లేదా లక్షణాలను వివరించండి.',
    alert_water_color: '⚠️ నీటి రంగు మార్పు — DO ని గమనించండి మరియు పాక్షికంగా నీటిని మార్చండి.',
    alert_water_smell: '⚠️ చెడు వాసన/నురుగు ఆక్సిజన్ తక్కువగా ఉన్నట్లు సూచిస్తుంది. ఎరేషన్ పెంచండి!',
    alert_growth_slow: '📉 నెమ్మదిగా పెరుగుదల — మేత నాణ్యత మరియు నీటి పారామితులను తనిఖీ చేయండి.',
    msg_weekly_footer: '\n\nఅద్భుతమైన వారపు అప్‌డేట్! ఇలాగే కొనసాగించండి! 📊'
  },
  Hindi: {
    q_wk_disease: '🔬 क्या इस सप्ताह कोई बीमारी के लक्षण दिखे?',
    btn_yes: 'हाँ',
    btn_no: 'नहीं',
    q_wk_feed: '🍽️ आपने इस सप्ताह कितना चारा उपयोग किया?',
    btn_wk_lt50: '50 किलो से कम',
    btn_wk_50_100: '50–100 किलो',
    btn_wk_100plus: '100+ किलो',
    q_wk_water: '💧 क्या इस सप्ताह पानी में कोई असामान्य बदलाव हुए?',
    btn_no_change: 'कोई बदलाव नहीं',
    btn_color_changed: 'रंग बदल गया',
    btn_bad_smell_foam: 'दुर्गंध/झाग',
    q_wk_growth: '📈 क्या आपकी झींगा/मछली इस सप्ताह सामान्य रूप से बढ़ रही है?',
    btn_growth_yes: 'हाँ, सामान्य',
    btn_growth_slow: 'हमेशा से धीमी',
    btn_growth_unsure: 'निश्चित नहीं',
    err_no_pond: '⚠️ कोई तालाब नहीं मिला। कृपया पहले सेटअप पूरा करें।',
    greet_weekly_checkin: '📋 *साप्ताहिक चेक-इन*\n\nत्वरित 4-प्रश्नों का साप्ताहिक सारांश। बस 1 मिनट लगता है! ⏱️',
    msg_weekly_saved: '✅ *साप्ताहिक रिपोर्ट सहेजी गई!*\n\n',
    label_disease_signs: '🔬 बीमारी के लक्षण',
    label_feed_used: '🍽️ उपयोग किया गया चारा',
    label_water: '💧 पानी',
    label_growth: '📈 विकास',
    alert_disease_yes: '⚠️ बीमारी के लक्षण दिखे! विश्लेषण के लिए एक फोटो भेजें या लक्षणों का वर्णन करें।',
    alert_water_color: '⚠️ पानी के रंग में बदलाव — DO की निगरानी करें और आंशिक रूप से पानी बदलने पर विचार करें।',
    alert_water_smell: '⚠️ दुर्गंध/झाग ऑक्सीजन की कमी को दर्शाता है। वातन बढ़ाएँ!',
    alert_growth_slow: '📉 धीमी वृद्धि — चारे की गुणवत्ता और पानी के मापदंडों की जाँच करें।',
    msg_weekly_footer: '\n\nशानदार साप्ताहिक अपडेट! इसे जारी रखें! 📊'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  startWeeklyCheckIn,
  handleWeeklyStep,
};
