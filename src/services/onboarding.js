const { sendTextMessage, sendButtonMessage, sendListMessage } = require('./whatsapp');
const { createFarmer, getFarmerByPhone, updateFarmer, createPond } = require('../models/database');
const { setState, getState, clearState, updateStateData, advanceGroup } = require('../state/conversationState');
const { deliverImmediateValue } = require('./immediateValue');

/**
 * Onboarding Flow — Day 1
 *
 * Step 0: Language selection (before groups)
 *
 * Group 1 — Farm Basics:
 *   1. What species are you growing? (buttons: Shrimp / Fish / Both)
 *   2. Which village are you from? (free text)
 *
 * Group 2 — Pond Details:
 *   3. When did you stock? (buttons: This week / This month / 1-2 months / 3+)
 *   4. Pond size? (buttons: <1 acre / 1-3 acres / 3+ acres)
 *
 * Success → Value Tip → How can I help today? (list)
 */

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    intro_g1: '👋 Let\'s get started! Just 2 quick questions about your farm.',
    intro_g2: '📋 Great! Now tell me about your pond.',
    q_species: '🌊 What species are you growing?',
    q_shrimp_type: '🦐 Which shrimp species are you growing?',
    q_fish_type: '🐟 Which fish species are you growing?',
    q_village: '📍 Which village or town are you from?',
    q_stocking: '📅 What was your *Stocking Date*? \n(Example: 15/05/2024 or 15-05-2024)',
    q_stock_err: '❌ Please enter a valid date in DD/MM/YYYY format. \nExample: 20/04/2024',

    q_size: '📐 What is the pond size?',
    btn_shrimp: '🦐 Shrimp',
    btn_vannamei: 'Vannamei',
    btn_tiger: 'Tiger Shrimp',
    btn_scampi: 'Scampi',
    btn_fish: '🐟 Fish',
    btn_both: '🦐🐟 Both',
    btn_tilapia: 'Tilapia',
    btn_imc: 'Rohu / IMC',
    btn_pangasius: 'Pangasius',
    btn_fish_other: 'Other Fish',
    btn_week: 'This week',
    btn_month: 'This month',
    btn_months_1_2: '1-2 months ago',
    btn_months_3_plus: '3+ months ago',
    btn_size_s: 'Less than 1 acre',
    btn_size_m: '1–3 acres',
    btn_size_l: 'More than 3 acres',
    reg_success: '🎉 *Registration Successful!*',
    farm_details: '📋 *Your Farm Details:*',
    label_type: '🌊 Type',
    label_village: '📍 Village',
    label_stocking: '📅 Stocking',
    label_stock_count: '🔢 Stock Count',
    label_size: '📐 Pond Size',
    pro_tip: '💡 *Pro Tip:* To build maximum value, analyze your pond data regularly. Tracking water quality and feed helps you avoid losses and grow faster!',
    ready_to_help: 'I am ready to help you manage your {type} farm. 🚀',
    help_today_q: '💡 *How can I help you today?*',
    help_today_desc: 'Select a topic below to get started immediately.',
    btn_select_topic: 'Select Topic',
    topic_disease: '🔬 Disease',
    topic_water: '💧 Water Quality',
    topic_feed: '🍽️ Feed Tips',
    topic_feed_plan: '🍽️ Feed Plan',
    desc_feed_plan: 'Daily feed calculator',
    topic_growth: '📈 Slow Growth',

    topic_mortality: '⚠️ Mortality',
    desc_mortality: 'Dealing with losses'
  },
  Telugu: {
    intro_g1: '👋 ప్రారంభిద్దాం! మీ ఫారం గురించి కేవలం 2 ప్రశ్నలు.',
    intro_g2: '📋 బాగుంది! ఇప్పుడు మీ చెరువు గురించి చెప్పండి.',
    q_species: '🌊 మీరు ఏ జాతిని పెంచుతున్నారు?',
    q_shrimp_type: '🦐 మీరు ఏ రకమైన రొయ్యలను పెంచుతున్నారు?',
    q_fish_type: '🐟 మీరు ఏ రకమైన చేపలను పెంచుతున్నారు?',
    q_village: '📍 మీ గ్రామం లేదా పట్టణం పేరు ఏమిటి?',
    q_stocking: '📅 మీరు ఈ చెరువులో విత్తనం (seed) ఎప్పుడు వేశారు? \n(ఉదాహరణ: 15/05/2024 లేదా 15-05-2024)',
    q_stock_err: '❌ దయచేసి సరైన తేదీని DD/MM/YYYY ఫార్మాట్‌లో నమోదు చేయండి. \nఉదాహరణ: 20/04/2024',

    q_size: '📐 చెరువు పరిమాణం ఎంత?',
    btn_shrimp: '🦐 రొయ్యలు',
    btn_vannamei: 'వన్నామీ',
    btn_tiger: 'టైగర్ రొయ్యలు',
    btn_scampi: 'స్కాంపీ',
    btn_fish: '🐟 చేపలు',
    btn_both: '🦐🐟 రెండూ',
    btn_tilapia: 'తిలాపియా',
    btn_imc: 'రోహు / ఐఎంసి',
    btn_pangasius: 'పంగేసియస్',
    btn_fish_other: 'ఇతర చేపలు',
    btn_week: 'ఈ వారం',
    btn_month: 'ఈ నెల',
    btn_months_1_2: '1-2 నెలల క్రితం',
    btn_months_3_plus: '3+ నెలల క్రితం',
    btn_size_s: '1 ఎకరం కంటే తక్కువ',
    btn_size_m: '1–3 ఎకరాలు',
    btn_size_l: '3 ఎకరాల కంటే ఎక్కువ',
    reg_success: '🎉 *రిజిస్ట్రేషన్ పూర్తయింది!*',
    farm_details: '📋 *మీ ఫారం వివరాలు:*',
    label_type: '🌊 రకం',
    label_village: '📍 గ్రామం',
    label_stocking: '📅 స్టాకింగ్',
    label_stock_count: '🔢 స్టాక్ కౌంట్',
    label_size: '📐 చెరువు పరిమాణం',
    pro_tip: '💡 *చిట్కా:* మీ ఫారం నుండి గరిష్ట లాభం పొందడానికి, మీ చెరువు డేటాను క్రమం తప్పకుండా విశ్లేషించండి. నీటి నాణ్యత మరియు మేతను పర్యవేక్షించడం నష్టాలను నివారించడానికి మరియు వేగంగా పెరగడానికి సహాయపడుతుంది!',
    ready_to_help: 'మీ {type} ఫారాన్ని నిర్వహించడానికి నేను సిద్ధంగా ఉన్నాను. 🚀',
    help_today_q: '💡 *ఈరోజు నేను మీకు ఎలా సహాయపడగలను?*',
    help_today_desc: 'వెంటనే ప్రారంభించడానికి క్రింద ఒక అంశాన్ని ఎంచుకోండి.',
    btn_select_topic: 'అంశాన్ని ఎంచుకోండి',
    topic_disease: '🔬 వ్యాధి',
    topic_water: '💧 నీటి నాణ్యత',
    topic_feed: '🍽️ మేత చిట్కాలు',
    topic_feed_plan: '🍽️ మేత ప్రణాళిక',
    desc_feed_plan: 'రోజువారీ మేత కాలిక్యులేటర్',
    topic_growth: '📈 నెమ్మదిగా పెరుగుదల',

    topic_mortality: '⚠️ మరణాలు',
    desc_mortality: 'నష్టాలను ఎదుర్కోవడం'
  },
  Hindi: {
    intro_g1: '👋 चलिए शुरू करते हैं! आपके फार्म के बारे में बस 2 सवाल।',
    intro_g2: '📋 बहुत अच्छा! अब अपने तालाब के बारे में बताएं।',
    q_species: '🌊 आप कौन सी प्रजाति पाल रहे हैं?',
    q_shrimp_type: '🦐 आप किस प्रकार की झींगा पाल रहे हैं?',
    q_fish_type: '🐟 आप किस प्रकार की मछली पाल रहे हैं?',
    q_village: '📍 आप किस गाँव या शहर से हैं?',
    q_stocking: '📅 आपने इस तालाब में स्टॉक कब किया? \n(उदाहरण: 15/05/2024 या 15-05-2024)',
    q_stock_err: '❌ कृपया DD/MM/YYYY फॉर्मेट में सही तारीख दर्ज करें। \nउदाहरण: 20/04/2024',

    q_size: '📐 तालाब का आकार क्या है?',
    btn_shrimp: '🦐 झींगा',
    btn_vannamei: 'वन्नामेई',
    btn_tiger: 'टाइगर झींगा',
    btn_scampi: 'स्कैम्पी',
    btn_fish: '🐟 मछली',
    btn_both: '🦐🐟 दोनों',
    btn_tilapia: 'तिलापिया',
    btn_imc: 'रोहू / आईएमसी',
    btn_pangasius: 'पंगासियस',
    btn_fish_other: 'अन्य मछली',
    btn_week: 'इस सप्ताह',
    btn_month: 'इस महीने',
    btn_months_1_2: '1-2 महीने पहले',
    btn_months_3_plus: '3+ महीने पहले',
    btn_size_s: '1 एकड़ से कम',
    btn_size_m: '1-3 एकड़',
    btn_size_l: '3 एकड़ से अधिक',
    reg_success: '🎉 *पंजीकरण सफल!*',
    farm_details: '📋 *आपके फार्म का विवरण:*',
    label_type: '🌊 प्रकार',
    label_village: '📍 गाँव',
    label_stocking: '📅 स्टॉकिंग',
    label_stock_count: '🔢 स्टॉक काउंट',
    label_size: '📐 तालाब का आकार',
    pro_tip: '💡 *सुझाव:* अधिकतम लाभ पाने के लिए, अपने तालाब के डेटा का नियमित रूप से विश्लेषण करें। पानी की गुणवत्ता और चारे की निगरानी करने से नुकसान से बचने और तेजी से बढ़ने में मदद मिलती है!',
    ready_to_help: 'मैं आपके {type} फार्म को प्रबंधित करने में मदद के लिए तैयार हूँ। 🚀',
    help_today_q: '💡 *आज मैं आपकी कैसे मदद कर सकता हूँ?*',
    help_today_desc: 'तुरंत शुरू करने के लिए नीचे एक विषय चुनें.',
    btn_select_topic: 'विषय चुनें',
    topic_disease: '🔬 बीमारी',
    topic_water: '💧 पानी की गुणवत्ता',
    topic_feed: '🍽️ चारा युक्तियाँ',
    topic_feed_plan: '🍽️ फीड प्लान',
    desc_feed_plan: 'दैनिक चारा कैलकुलेटर',
    topic_growth: '📈 धीमी वृद्धि',

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
    group: 0, // 0 = language step, 1/2/3 = groups
    step: 0,
    data: {},
    farmerId: farmer.id,
    pondId: null,
  });

  // Ask language first
  await sendButtonMessage(phone,
    '🦐🐟 Welcome to *aquaIQ*!\nYour Smart Pond Assistant\n\nSelect your language:\nమీ భాషను ఎంచుకోండి:\nअपनी भाषा चुनें:',
    [
      { id: 'lang_en', title: 'English' },
      { id: 'lang_te', title: 'Telugu' },
      { id: 'lang_hi', title: 'Hindi' },
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
      await sendButtonMessage(phone,
        'Please select your language:',
        [
          { id: 'lang_en', title: 'English' },
          { id: 'lang_te', title: 'Telugu' },
          { id: 'lang_hi', title: 'Hindi' },
        ]
      );
      return true;
    }

    // Save language and move to group 1
    updateStateData(phone, { preferred_language: lang });
    const updated = getState(phone);
    setState(phone, { ...updated, group: 1, step: 0 });

    await sendTextMessage(phone, getGroupIntro(1, lang));
    await askGroupQuestion(phone);
    return true;
  }

  // ---- GROUP 1: Farm Basics ----
  if (group === 1) {
    if (step === 0) {
      // Q1: What species are you growing?
      let farmType = null;
      if (input.includes('shrimp') || input === 'farm_shrimp') farmType = 'shrimp';
      else if (input.includes('fish') || input === 'farm_fish') farmType = 'fish';
      else if (input.includes('both') || input === 'farm_both') farmType = 'both';

      if (!farmType) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { farm_type: farmType });
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 1) {
      // Q2: Village (free text)
      if (input.length < 2) {
        await sendTextMessage(phone, 'Please tell me your village or town name.');
        return true;
      }

      updateStateData(phone, { village: message.trim() });

      const current = getState(phone);
      const farmType = current.data.farm_type;

      // Conditional Step: route to Shrimp Type or Fish Type
      if (farmType === 'shrimp' || farmType === 'both') {
        setState(phone, { ...current, step: 2 });
      } else if (farmType === 'fish') {
        setState(phone, { ...current, step: 3 });
      }
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 2) {
      // Q3: Shrimp Type
      let shrimpType = null;
      if (input.includes('vannamei') || input === 'shrimp_vannamei') shrimpType = 'vannamei';
      else if (input.includes('tiger') || input === 'shrimp_tiger') shrimpType = 'tiger_shrimp';
      else if (input.includes('scampi') || input === 'shrimp_scampi') shrimpType = 'scampi';

      if (!shrimpType) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { shrimp_species: shrimpType });

      const current = getState(phone);
      const farmType = current.data.farm_type;

      if (farmType === 'both') {
        setState(phone, { ...current, step: 3 });
        await askGroupQuestion(phone);
        return true;
      }

      // Group 1 done → move to group 2
      setState(phone, { ...current, group: 2, step: 0 });

      const lang = current.data.preferred_language || 'English';
      await sendTextMessage(phone, getGroupIntro(2, lang));
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 3) {
      // Q4: Fish Type
      let fishType = null;
      if (input.includes('tilapia') || input === 'fish_tilapia') fishType = 'tilapia';
      else if (input.includes('rohu') || input.includes('imc') || input === 'fish_imc') fishType = 'rohu';
      else if (input.includes('pangasius') || input === 'fish_pangasius') fishType = 'pangasius';
      else if (input.includes('other') || input === 'fish_other') fishType = 'other_fish';

      if (!fishType) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { fish_species: fishType });

      // Group 1 done → move to group 2
      const current = getState(phone);
      setState(phone, { ...current, group: 2, step: 0 });

      const lang = current.data.preferred_language || 'English';
      await sendTextMessage(phone, getGroupIntro(2, lang));
      await askGroupQuestion(phone);
      return true;
    }
  }

  // ---- GROUP 2: Pond Details ----
  if (group === 2) {
    if (step === 0) {
      // Q3: Stocking date (Free text parsing)
      const dateParts = input.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      
      if (!dateParts) {
        const lang = state.data.preferred_language || 'English';
        await sendTextMessage(phone, t('q_stock_err', lang));
        return true;
      }

      let [_, d, m, y] = dateParts;
      if (y.length === 2) y = '20' + y;
      
      const parsedDate = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
      
      if (isNaN(parsedDate.getTime()) || parsedDate > new Date()) {
        const lang = state.data.preferred_language || 'English';
        await sendTextMessage(phone, t('q_stock_err', lang));
        return true;
      }

      const isoDate = parsedDate.toISOString().split('T')[0];
      updateStateData(phone, { stocking_date: isoDate });
      
      const current = getState(phone);
      setState(phone, { ...current, step: 1 });
      await askGroupQuestion(phone);
      return true;
    }


    if (step === 1) {
      // Q3.5: Stock Count (Numeric)
      const count = parseInt(input.replace(/[^0-9]/g, ''));
      if (isNaN(count) || count <= 0) {
        await sendTextMessage(phone, 'Please enter a valid number for the stock count.');
        return true;
      }

      updateStateData(phone, { seed_count: count });
      
      const current = getState(phone);
      setState(phone, { ...current, step: 2 });
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 2) {
      // Q4: Pond size
      let pondSize = null;
      if (input.includes('less') || input.includes('<1') || input === 'size_small') pondSize = 'less_than_1_acre';
      else if (input.includes('1') && input.includes('3') || input === 'size_medium') pondSize = '1_3_acres';
      else if (input.includes('more') || input.includes('>3') || input === 'size_large') pondSize = 'more_than_3_acres';

      if (!pondSize) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { pond_size: pondSize });

      // All onboarding groups done → Finalize Registration
      await finalizeOnboarding(phone);
      return true;
    }
  }


  return false;
}

// ========================
// ASK GROUP QUESTION
// ========================

async function askGroupQuestion(phone) {
  const state = getState(phone);
  const group = state.group;
  const step = state.step;
  const lang = state.data.preferred_language || 'English';

  // GROUP 1
  if (group === 1) {
    if (step === 0) {
      await sendButtonMessage(phone,
        t('q_species', lang),
        [
          { id: 'farm_shrimp', title: t('btn_shrimp', lang) },
          { id: 'farm_fish', title: t('btn_fish', lang) },
          { id: 'farm_both', title: t('btn_both', lang) },
        ]
      );
      return;
    }
    if (step === 1) {
      await sendTextMessage(phone, t('q_village', lang));
      return;
    }
    if (step === 2) {
      await sendButtonMessage(phone,
        t('q_shrimp_type', lang),
        [
          { id: 'shrimp_vannamei', title: t('btn_vannamei', lang) },
          { id: 'shrimp_tiger', title: t('btn_tiger', lang) },
          { id: 'shrimp_scampi', title: t('btn_scampi', lang) },
        ]
      );
      return;
    }
    if (step === 3) {
      await sendButtonMessage(phone,
        t('q_fish_type', lang),
        [
          { id: 'fish_tilapia', title: t('btn_tilapia', lang) },
          { id: 'fish_imc', title: t('btn_imc', lang) },
          { id: 'fish_pangasius', title: t('btn_pangasius', lang) },
        ]
      );
      return;
    }
  }

  // GROUP 2
  if (group === 2) {
    if (step === 0) {
      await sendTextMessage(phone, t('q_stocking', lang));
      return;
    }

    if (step === 1) {
      await sendTextMessage(phone, t('q_stock_count', lang));
      return;
    }
    if (step === 2) {
      await sendButtonMessage(phone,
        t('q_size', lang),
        [
          { id: 'size_small', title: t('btn_size_s', lang) },
          { id: 'size_medium', title: t('btn_size_m', lang) },
          { id: 'size_large', title: t('btn_size_l', lang) },
        ]
      );
      return;
    }
  }
}

// ========================
// FINALIZE ONBOARDING
// ========================

async function finalizeOnboarding(phone) {
  const state = getState(phone);
  const data = state.data;

  // Set species based on farm type
  let species = 'vannamei';
  if (data.farm_type === 'shrimp' && data.shrimp_species) species = data.shrimp_species;
  if (data.farm_type === 'fish' && data.fish_species) species = data.fish_species;
  if (data.farm_type === 'both') {
    species = (data.shrimp_species || 'vannamei') + '_and_' + (data.fish_species || 'tilapia');
  }

  // Update farmer record
  await updateFarmer(state.farmerId, {
    village: data.village,
    farm_type: data.farm_type,
    preferred_language: data.preferred_language,
    pond_count: 1, // Defaulting to 1 as requested to remove question
    onboarding_complete: true,
    onboarding_day: 1,
  });

  // Create first pond
  await createPond({
    farmer_id: state.farmerId,
    pond_number: 1,
    species: species,
    stocking_date: data.stocking_date,
    pond_size: data.pond_size,
    seed_count: data.seed_count,
  });

  clearState(phone);

  // Registration Success + Summary + Value Tip
  const lang = data.preferred_language || 'English';
  const farmTypeLabel = data.farm_type === 'shrimp' ? t('btn_shrimp', lang) : (data.farm_type === 'fish' ? t('btn_fish', lang) : t('btn_both', lang));

  await sendTextMessage(phone,
    `${t('reg_success', lang)}\n\n` +
    `${t('farm_details', lang)}\n` +
    `${t('label_type', lang)}: ${farmTypeLabel}\n` +
    `${t('label_village', lang)}: ${data.village}\n` +
    `${t('label_stocking', lang)}: ${getStockingLabel(data.stocking_date, lang)}\n` +
    `${t('label_stock_count', lang)}: ${data.seed_count.toLocaleString()}\n` +
    `${t('label_size', lang)}: ${getSizeLabel(data.pond_size, lang)}\n\n` +
    `${t('pro_tip', lang)}\n\n` +
    `${t('ready_to_help', lang).replace('{type}', farmTypeLabel.toLowerCase())}`
  );

  // Ask how they want help today
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

// ========================
// HELPERS
// ========================

function getGroupIntro(group, lang) {
  if (group === 1) return t('intro_g1', lang);
  if (group === 2) return t('intro_g2', lang);
  return '';
}

function getSpeciesLabel(species) {
  const labels = {
    vannamei: 'Vannamei Shrimp',
    tiger_shrimp: 'Tiger Shrimp',
    tilapia: 'Tilapia',
    rohu: 'Rohu',
    catla: 'Catla',
    other: 'Other',
  };
  return labels[species] || species;
}

function getSizeLabel(size, lang = 'English') {
  const labels = {
    less_than_1_acre: t('btn_size_s', lang),
    '1_3_acres': t('btn_size_m', lang),
    more_than_3_acres: t('btn_size_l', lang),
  };
  return labels[size] || size;
}

function getStockingLabel(date, lang = 'English') {
  if (date && date.includes('-')) {
    const [y, m, d] = date.split('-');
    return `${d}/${m}/${y}`;
  }
  const labels = {
    this_week: t('btn_week', lang),
    this_month: t('btn_month', lang),
    '1_2_months': t('btn_months_1_2', lang),
    '3_plus_months': t('btn_months_3_plus', lang),
  };
  return labels[date] || date;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

module.exports = {
  startOnboarding,
  handleOnboardingStep,
};
