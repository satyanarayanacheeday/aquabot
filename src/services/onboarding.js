const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { createFarmer, getFarmerByPhone, updateFarmer, createPond } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Simplified Onboarding Flow
 *
 * 1. Language (Buttons)
 * 2. Village (Free Text)
 * 3. Species (Shrimp / Fish / Both)
 *
 * Success → Value Tip → How can I help today? (list)
 */

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    intro_g1: '👋 Let\'s get started! Just a few quick questions about your farm.',
    q_species: '🌊 What species are you growing?',
    q_village: '📍 Which village or town are you from?',
    btn_shrimp: '🦐 Shrimp',
    btn_fish: '🐟 Fish',
    btn_both: '🦐🐟 Both',
    reg_success: '🎉 *Registration Successful!*',
    farm_details: '📋 *Your Farm Details:*',
    label_type: '🌊 Type',
    label_village: '📍 Village',
    pro_tip: '💡 *Pro Tip:* To build maximum value, analyze your pond data regularly. Tracking water quality and feed helps you avoid losses and grow faster!',
    ready_to_help: 'I am ready to help you manage your {type} farm. 🚀',
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
    desc_mortality: 'Dealing with sudden losses'
  },

  Telugu: {
    intro_g1: '👋 ప్రారంభిద్దాం! మీ ఫారం గురించి కొన్ని త్వరిత ప్రశ్నలు.',
    q_species: '🌊 మీరు ఏ జాతిని పెంచుతున్నారు?',
    q_village: '📍 మీ గ్రామం లేదా పట్టణం పేరు ఏమిటి?',
    btn_shrimp: '🦐 రొయ్యలు',
    btn_fish: '🐟 చేపలు',
    btn_both: '🦐🐟 రెండూ',
    reg_success: '🎉 *రిజిస్ట్రేషన్ పూర్తయింది!*',
    farm_details: '📋 *మీ ఫారం వివరాలు:*',
    label_type: '🌊 రకం',
    label_village: '📍 గ్రామం',
    pro_tip: '💡 *చిట్కా:* మీ ఫారం నుండి గరిష్ట లాభం పొందడానికి, మీ చెరువు డేటాను క్రమం తప్పకుండా విశ్లేషించండి. నీటి నాణ్యత మరియు మేతను పర్యవేక్షించడం నష్టాలను నివారించడానికి మరియు వేగంగా పెరగడానికి సహాయపడుతుంది!',
    ready_to_help: 'మీ {type} ఫారాన్ని నిర్వహించడానికి నేను సిద్ధంగా ఉన్నాను. 🚀',
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
    desc_mortality: 'నష్టాలను ఎదుర్కోవడం'
  },

  Hindi: {
    intro_g1: '👋 चलिए शुरू करते हैं! आपके फार्म के बारे में कुछ त्वरित प्रश्न।',
    q_species: '🌊 आप कौन सी प्रजाति पाल रहे हैं?',
    q_village: '📍 आप किस गाँव या शहर से हैं?',
    btn_shrimp: '🦐 झींगा',
    btn_fish: '🐟 मछली',
    btn_both: '🦐🐟 दोनों',
    reg_success: '🎉 *पंजीकरण सफल!*',
    farm_details: '📋 *आपके फार्म का विवरण:*',
    label_type: '🌊 प्रकार',
    label_village: '📍 गाँव',
    pro_tip: '💡 *सुझाव:* अधिकतम लाभ पाने के लिए, अपने तालाब के डेटा का नियमित रूप से विश्लेषण करें। पानी की गुणवत्ता और चारे की निगरानी करने से नुकसान से बचने और तेजी से बढ़ने में मदद मिलती है!',
    ready_to_help: 'मैं आपके {type} फार्म को प्रबंधित करने में मदद के लिए तैयार हूँ। 🚀',
    help_today_q: '💡 *आज मैं आपकी कैसे मदद कर सकता हूँ?*',
    help_today_desc: 'तुरंत शुरू करने के लिए नीचे एक विषय चुनें.',
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
    desc_mortality: 'नुकसान से निपटना'
  }

};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

// ========================
// START ONBOARDING
// ========================

async function startOnboarding(phone) {
  let farmer = await getFarmerByPhone(phone);
  if (!farmer) {
    farmer = await createFarmer({ phone, onboarding_complete: false });
  }

  setState(phone, {
    flow: 'onboarding',
    group: 0, 
    step: 0,
    data: {},
    farmerId: farmer.id
  });

  await sendButtonMessage(phone,
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
  const group = state.group;
  const step = state.step;

  // ---- LANGUAGE SELECTION (group 0) ----
  if (group === 0) {
    let lang = null;
    if (input.includes('english') || input === 'lang_en') lang = 'English';
    else if (input.includes('telugu') || input.includes('తెలుగు') || input === 'lang_te') lang = 'Telugu';
    else if (input.includes('hindi') || input.includes('हिंदी') || input === 'lang_hi') lang = 'Hindi';

    if (!lang) {
      await sendButtonMessage(phone, 'Please select your language:', [
        { id: 'lang_en', title: 'English' },
        { id: 'lang_te', title: 'తెలుగు (Telugu)' },
        { id: 'lang_hi', title: 'हिंदी (Hindi)' },
      ]);
      return true;
    }

    updateStateData(phone, { preferred_language: lang });
    setState(phone, { ...getState(phone), group: 1, step: 0 });

    await sendTextMessage(phone, t('intro_g1', lang));
    await sendTextMessage(phone, t('q_village', lang));
    return true;
  }

  // ---- GROUP 1: BASICS ----
  if (group === 1) {
    if (step === 0) {
      // Village
      if (input.length < 2) {
        const lang = state.data.preferred_language || 'English';
        await sendTextMessage(phone, t('q_village', lang));
        return true;
      }
      updateStateData(phone, { village: message.trim() });
      setState(phone, { ...getState(phone), step: 1 });
      
      const lang = state.data.preferred_language || 'English';
      await sendButtonMessage(phone, t('q_species', lang), [
        { id: 'farm_shrimp', title: t('btn_shrimp', lang) },
        { id: 'farm_fish', title: t('btn_fish', lang) },
        { id: 'farm_both', title: t('btn_both', lang) },
      ]);
      return true;
    }

    if (step === 1) {
      // Species
      let farmType = null;
      if (input.includes('shrimp') || input === 'farm_shrimp') farmType = 'shrimp';
      else if (input.includes('fish') || input === 'farm_fish') farmType = 'fish';
      else if (input.includes('both') || input === 'farm_both') farmType = 'both';

      if (!farmType) {
        const lang = state.data.preferred_language || 'English';
        await sendButtonMessage(phone, t('q_species', lang), [
          { id: 'farm_shrimp', title: t('btn_shrimp', lang) },
          { id: 'farm_fish', title: t('btn_fish', lang) },
          { id: 'farm_both', title: t('btn_both', lang) },
        ]);
        return true;
      }

      updateStateData(phone, { farm_type: farmType });
      await finalizeOnboarding(phone);
      return true;
    }
  }

  return false;
}

// ========================
// FINALIZE ONBOARDING
// ========================

async function finalizeOnboarding(phone) {
  const state = getState(phone);
  const data = state.data;
  const lang = data.preferred_language || 'English';

  // Update farmer
  await updateFarmer(state.farmerId, {
    village: data.village,
    farm_type: data.farm_type,
    preferred_language: lang,
    onboarding_complete: true
  });

  // Create initial pond with placeholders (JIT collection will fill these later)
  await createPond({
    farmer_id: state.farmerId,
    pond_number: 1,
    species: data.farm_type === 'shrimp' ? 'vannamei' : (data.farm_type === 'fish' ? 'tilapia' : 'vannamei_and_tilapia'),
    stocking_date: null,
    pond_size: null,
    seed_count: null
  });

  clearState(phone);

  const farmTypeLabel = data.farm_type === 'shrimp' ? t('btn_shrimp', lang) : (data.farm_type === 'fish' ? t('btn_fish', lang) : t('btn_both', lang));

  await sendTextMessage(phone,
    `${t('reg_success', lang)}\n\n` +
    `${t('farm_details', lang)}\n` +
    `${t('label_type', lang)}: ${farmTypeLabel}\n` +
    `${t('label_village', lang)}: ${data.village}\n\n` +
    `${t('pro_tip', lang)}\n\n` +
    `${t('ready_to_help', lang).replace('{type}', farmTypeLabel.toLowerCase())}`
  );

  await sendListMessage(phone,
    t('help_today_q', lang) + '\n\n' + t('help_today_desc', lang),
    t('btn_select_topic', lang),
    [{
      title: t('btn_select_topic', lang),
      rows: [
        { id: 'prob_disease', title: t('topic_disease', lang), description: t('desc_disease', lang) },
        { id: 'prob_water', title: t('topic_water', lang), description: t('desc_water', lang) },
        { id: 'prob_feed_plan', title: t('topic_feed_plan', lang), description: t('desc_feed_plan', lang) },
        { id: 'prob_growth', title: t('topic_growth', lang), description: t('desc_growth', lang) },
        { id: 'prob_mortality', title: t('topic_mortality', lang), description: t('desc_mortality', lang) },
      ],

    }]
  );
}

module.exports = {
  startOnboarding,
  handleOnboardingStep,
};
