const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { createFarmer, getFarmerByPhone, updateFarmer, createPond } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Low-Friction Onboarding Flow
 *
 * Step 1: Language selection   (3 buttons — 1 tap)
 * Step 2: Species selection    (3 buttons — 1 tap)
 * Done  → Welcome message + Main menu instantly
 *
 * Village, stocking date, pond size, seed count
 * are all collected JIT (Just-In-Time) when a feature actually needs them.
 *
 * Why species upfront? It drives feed calculations, disease detection,
 * daily advisories and AI context — too critical to defer.
 */

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    // welcome_msg supports {species} placeholder
    welcome_msg:
      '🎉 *Welcome to aquaIQ!*\n\nSet up for *{species}* farming. Your Smart Pond Assistant is ready. 🚀\n\n💡 I\'ll ask for remaining pond details only when needed.',
    help_today_q: '💡 *How can I help you today?*',
    help_today_desc: 'Select a topic below to get started immediately.',
    btn_select_topic: 'Select Topic',
    topic_disease: '🔬 Disease',
    desc_disease: 'Report symptoms & get advice',
    topic_water: '💧 Water Quality',
    desc_water: 'Manage ammonia, pH, & DO',
    topic_feed_plan: '🍽️ Feed Plan',
    desc_feed_plan: 'Daily feed calculator',
    topic_growth: '📈 Slow Growth',
    desc_growth: 'Improve growth rates',
    topic_mortality: '⚠️ Mortality',
    desc_mortality: 'Dealing with sudden losses',
    // Onboarding step 2
    q_species: '🌊 What are you farming?',
    btn_shrimp: '🦐 Shrimp',
    btn_fish: '🐟 Fish',
    btn_both: '🦐🐟 Both',
    // JIT — village collection
    q_village: '📍 Which village or town are you from? (Helps me give local advice)',
  },

  Telugu: {
    welcome_msg:
      '🎉 *aquaIQ కి స్వాగతం!*\n\n*{species}* సాగు కోసం సెటప్ పూర్తయింది. మీ స్మార్ట్ చెరువు అసిస్టెంట్ సిద్ధంగా ఉంది. 🚀\n\n💡 మిగిలిన వివరాలు అవసరమైనప్పుడు మాత్రమే అడుగుతాను.',
    help_today_q: '💡 *ఈరోజు నేను మీకు ఎలా సహాయపడగలను?*',
    help_today_desc: 'వెంటనే ప్రారంభించడానికి క్రింద ఒక అంశాన్ని ఎంచుకోండి.',
    btn_select_topic: 'అంశాన్ని ఎంచుకోండి',
    topic_disease: '🔬 వ్యాధి',
    desc_disease: 'లక్షణాలు మరియు సలహాలు',
    topic_water: '💧 నీటి నాణ్యత',
    desc_water: 'అమ్మోనియా, pH, మరియు DO',
    topic_feed_plan: '🍽️ మేత ప్రణాళిక',
    desc_feed_plan: 'రోజువారీ మేత కాలిక్యులేటర్',
    topic_growth: '📈 నెమ్మదిగా పెరుగుదల',
    desc_growth: 'పెరుగుదల రేటును మెరుగుపరచండి',
    topic_mortality: '⚠️ మరణాలు',
    desc_mortality: 'నష్టాలను ఎదుర్కోవడం',
    // Onboarding step 2
    q_species: '🌊 మీరు ఏ జాతిని పెంచుతున్నారు?',
    btn_shrimp: '🦐 రొయ్యలు',
    btn_fish: '🐟 చేపలు',
    btn_both: '🦐🐟 రెండూ',
    // JIT — village collection
    q_village: '📍 మీ గ్రామం లేదా పట్టణం పేరు ఏమిటి? (స్థానిక సలహా ఇవ్వడానికి సహాయపడుతుంది)',
  },

  Hindi: {
    welcome_msg:
      '🎉 *aquaIQ में आपका स्वागत है!*\n\n*{species}* खेती के लिए सेटअप हो गया। आपका स्मार्ट तालाब सहायक तैयार है। 🚀\n\n💡 बाकी जानकारी केवल जरूरत पड़ने पर मांगूंगा।',
    help_today_q: '💡 *आज मैं आपकी कैसे मदद कर सकता हूँ?*',
    help_today_desc: 'तुरंत शुरू करने के लिए नीचे एक विषय चुनें।',
    btn_select_topic: 'विषय चुनें',
    topic_disease: '🔬 बीमारी',
    desc_disease: 'लक्षण और सलाह',
    topic_water: '💧 पानी की गुणवत्ता',
    desc_water: 'अमोनिया, pH और DO प्रबंधन',
    topic_feed_plan: '🍽️ फीड प्लान',
    desc_feed_plan: 'दैनिक चारा कैलकुलेटर',
    topic_growth: '📈 धीमी वृद्धि',
    desc_growth: 'विकास दर में सुधार',
    topic_mortality: '⚠️ मृत्यु दर',
    desc_mortality: 'नुकसान से निपटना',
    // Onboarding step 2
    q_species: '🌊 आप कौन सी प्रजाति पाल रहे हैं?',
    btn_shrimp: '🦐 झींगा',
    btn_fish: '🐟 मछली',
    btn_both: '🦐🐟 दोनों',
    // JIT — village collection
    q_village: '📍 आप किस गाँव या शहर से हैं? (स्थानीय सलाह देने में मदद करता है)',
  },
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

// ========================
// START ONBOARDING
// ========================

/**
 * @param {string} phone
 * @param {object} [options]
 * @param {string} [options.pendingMessage]      - Text message farmer sent before onboarding
 * @param {Buffer} [options.pendingImageBuffer]  - Image buffer downloaded before onboarding
 * @param {string} [options.pendingImageMimeType]
 */
async function startOnboarding(phone, options = {}) {
  let farmer = await getFarmerByPhone(phone);
  if (!farmer) {
    farmer = await createFarmer({ phone, onboarding_complete: false });
  }

  setState(phone, {
    flow: 'onboarding',
    group: 0,
    step: 0,
    data: {},
    farmerId: farmer.id,
    // Store any pending message/image so we can auto-process after onboarding
    pendingMessage:       options.pendingMessage       || null,
    pendingImageBuffer:   options.pendingImageBuffer   || null,
    pendingImageMimeType: options.pendingImageMimeType || null,
  });

  await sendButtonMessage(
    phone,
    '🦐🐟 Welcome to *aquaIQ*!\nYour Smart Pond Assistant\n\nSelect your language:\nమీ భాషను ఎంచుకోండి:\nअपनी भाषा चुनें:',
    [
      { id: 'lang_en', title: 'English' },
      { id: 'lang_te', title: 'తెలుగు (Telugu)' },
      { id: 'lang_hi', title: 'हिंदी (Hindi)' },
    ]
  );
}

// ========================
// HANDLE ONBOARDING STEP
// ========================

async function handleOnboardingStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'onboarding') return false;

  const input = message.toLowerCase().trim();

  // ---- STEP 1: Language Selection (group 0) ----
  if (state.group === 0) {
    let lang = null;
    if (input.includes('english') || input === 'lang_en') lang = 'English';
    else if (input.includes('telugu') || input.includes('తెలుగు') || input === 'lang_te') lang = 'Telugu';
    else if (input.includes('hindi') || input.includes('हिंदी') || input === 'lang_hi') lang = 'Hindi';

    if (!lang) {
      // Unrecognised input — re-prompt
      await sendButtonMessage(phone, 'Please select your language:', [
        { id: 'lang_en', title: 'English' },
        { id: 'lang_te', title: 'తెలుగు (Telugu)' },
        { id: 'lang_hi', title: 'हिंदी (Hindi)' },
      ]);
      return true;
    }

    // Save language, advance to species step
    setState(phone, {
      ...state,
      group: 1,
      step: 0,
      data: { preferred_language: lang },
    });

    // Ask species immediately (no extra message — straight to the question)
    await sendButtonMessage(phone, t('q_species', lang), [
      { id: 'ob_shrimp', title: t('btn_shrimp', lang) },
      { id: 'ob_fish',   title: t('btn_fish', lang) },
      { id: 'ob_both',   title: t('btn_both', lang) },
    ]);
    return true;
  }

  // ---- STEP 2: Species Selection (group 1) ----
  if (state.group === 1) {
    const lang = state.data.preferred_language || 'English';
    let farmType = null;

    if (input.includes('shrimp') || input === 'ob_shrimp') farmType = 'shrimp';
    else if (input.includes('fish') || input === 'ob_fish') farmType = 'fish';
    else if (input.includes('both') || input === 'ob_both') farmType = 'both';

    if (!farmType) {
      // Unrecognised input — re-prompt
      await sendButtonMessage(phone, t('q_species', lang), [
        { id: 'ob_shrimp', title: t('btn_shrimp', lang) },
        { id: 'ob_fish',   title: t('btn_fish', lang) },
        { id: 'ob_both',   title: t('btn_both', lang) },
      ]);
      return null;
    }

    // Species captured — finalize and return any pending data
    setState(phone, {
      ...getState(phone),
      data: { ...state.data, farm_type: farmType },
    });
    const pending = await finalizeOnboarding(phone, lang, farmType);
    return pending; // { message, imageBuffer, imageMimeType } or null
  }

  return null;
}

// ========================
// FINALIZE ONBOARDING
// ========================

/**
 * Persists farmer + pond, then shows welcome + main menu.
 * @param {string} phone
 * @param {string} lang     - 'English' | 'Telugu' | 'Hindi'
 * @param {string} farmType - 'shrimp' | 'fish' | 'both'
 */
async function finalizeOnboarding(phone, lang, farmType) {
  const state = getState(phone);
  if (!state) return null;

  // Capture any pending message/image BEFORE clearing state
  const pending = {
    message:       state.pendingMessage       || null,
    imageBuffer:   state.pendingImageBuffer   || null,
    imageMimeType: state.pendingImageMimeType || null,
  };

  // Map farm_type → default pond species
  const speciesMap = {
    shrimp: 'vannamei',
    fish:   'tilapia',
    both:   'vannamei_and_tilapia',
  };
  const species = speciesMap[farmType] || 'vannamei';

  try {
    // Save farmer with language + species/farm_type known
    // village is collected JIT later
    await updateFarmer(state.farmerId, {
      preferred_language: lang,
      farm_type: farmType,
      onboarding_complete: true,
    });

    // Create starter pond — stocking_date, pond_size, seed_count collected JIT
    await createPond({
      farmer_id: state.farmerId,
      pond_number: 1,
      species,
      stocking_date: null,
      pond_size: null,
      seed_count: null,
    });
  } catch (err) {
    const logger = require('../utils/logger');
    logger.error('Error finalizing onboarding', { phone, error: err.message });
    // Continue — don't leave farmer stuck at the language screen
  }

  clearState(phone);

  // Welcome message (acknowledges their species choice)
  const speciesLabel = t(`btn_${farmType}`, lang);
  await sendTextMessage(
    phone,
    t('welcome_msg', lang).replace('{species}', speciesLabel)
  );

  // Immediately show the main topic menu
  await sendListMessage(
    phone,
    t('help_today_q', lang) + '\n\n' + t('help_today_desc', lang),
    t('btn_select_topic', lang),
    [
      {
        title: t('btn_select_topic', lang),
        rows: [
          { id: 'prob_disease',       title: t('topic_disease', lang),  description: t('desc_disease', lang) },
          { id: 'prob_water_quality', title: t('topic_water', lang),    description: t('desc_water', lang) },
          { id: 'prob_feed_plan',     title: t('topic_feed_plan', lang),description: t('desc_feed_plan', lang) },
          { id: 'prob_slow_growth',   title: t('topic_growth', lang),   description: t('desc_growth', lang) },
          { id: 'prob_mortality',     title: t('topic_mortality', lang),description: t('desc_mortality', lang) },
        ],
      },
    ]
  );

  // Return pending data so caller can auto-process it
  return (pending.message || pending.imageBuffer) ? pending : null;
}

// ========================
// JIT SPECIES COLLECTION
// Called from webhookController when a feature needs farm_type / species
// ========================

async function askSpeciesJIT(phone, lang = 'English') {
  await sendButtonMessage(phone, t('q_species', lang), [
    { id: 'jit_shrimp', title: t('btn_shrimp', lang) },
    { id: 'jit_fish',   title: t('btn_fish', lang) },
    { id: 'jit_both',   title: t('btn_both', lang) },
  ]);
}

// ========================
// JIT VILLAGE COLLECTION
// Called from webhookController when a feature needs farmer.village
// ========================

async function askVillageJIT(phone, lang = 'English') {
  await sendTextMessage(phone, t('q_village', lang));
}

module.exports = {
  startOnboarding,
  handleOnboardingStep,
  askSpeciesJIT,
  askVillageJIT,
  translations,
  t,
};
