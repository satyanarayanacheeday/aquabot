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
 *   1. What do you farm? (buttons: Shrimp / Fish / Both)
 *   2. Which village are you from? (free text)
 *   3. How many ponds? (buttons: 1 / 2 / 3 / 4+)
 *
 * Group 2 — Pond Details:
 *   4. Species? (list: Vannamei / Tiger / Tilapia / Rohu / Catla / Other)
 *   5. When did you stock? (buttons: This week / This month / 1-2 months / 3+)
 *   6. Pond size? (buttons: <1 acre / 1-3 acres / 3+ acres)
 *
 * Group 3 — Current Problem:
 *   7. What do you want help with today? (list)
 *
 * Then → deliverImmediateValue()
 */

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
    '🦐🐟 Welcome to *Aquorix*!\nYour Smart Pond Assistant\n\nSelect your language:\nమీ భాషను ఎంచుకోండి:\nअपनी भाषा चुनें:',
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
      // Q1: What do you farm?
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
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 2) {
      // Q3: Pond count
      let pondCount = null;
      if (input === '1' || input === 'ponds_1') pondCount = 1;
      else if (input === '2' || input === 'ponds_2') pondCount = 2;
      else if (input === '3' || input === 'ponds_3') pondCount = 3;
      else if (input.includes('4') || input === 'ponds_4plus') pondCount = 4;

      if (!pondCount) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { pond_count: pondCount });

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
      // Q4: Species (list)
      let species = null;
      if (input.includes('vannamei') || input === 'sp_vannamei') species = 'vannamei';
      else if (input.includes('tiger') || input === 'sp_tiger') species = 'tiger_shrimp';
      else if (input.includes('tilapia') || input === 'sp_tilapia') species = 'tilapia';
      else if (input.includes('rohu') || input === 'sp_rohu') species = 'rohu';
      else if (input.includes('catla') || input === 'sp_catla') species = 'catla';
      else if (input.includes('other') || input === 'sp_other') species = 'other';

      if (!species) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { species });
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 1) {
      // Q5: Stocking date
      let stockDate = null;
      if (input.includes('this week') || input === 'stock_week') stockDate = 'this_week';
      else if (input.includes('this month') || input === 'stock_month') stockDate = 'this_month';
      else if (input.includes('1-2') || input.includes('1 to 2') || input === 'stock_1_2') stockDate = '1_2_months';
      else if (input.includes('3') || input.includes('more') || input === 'stock_3plus') stockDate = '3_plus_months';

      if (!stockDate) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { stocking_date: stockDate });
      await askGroupQuestion(phone);
      return true;
    }

    if (step === 2) {
      // Q6: Pond size
      let pondSize = null;
      if (input.includes('less') || input.includes('<1') || input === 'size_small') pondSize = 'less_than_1_acre';
      else if (input.includes('1') && input.includes('3') || input === 'size_medium') pondSize = '1_3_acres';
      else if (input.includes('more') || input.includes('>3') || input === 'size_large') pondSize = 'more_than_3_acres';

      if (!pondSize) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { pond_size: pondSize });

      // Group 2 done → move to group 3
      const current = getState(phone);
      setState(phone, { ...current, group: 3, step: 0 });

      const lang = current.data.preferred_language || 'English';
      await sendTextMessage(phone, getGroupIntro(3, lang));
      await askGroupQuestion(phone);
      return true;
    }
  }

  // ---- GROUP 3: Current Problem ----
  if (group === 3) {
    if (step === 0) {
      // Q7: What do you want help with?
      let problem = null;
      if (input.includes('disease') || input === 'prob_disease') problem = 'disease';
      else if (input.includes('water') || input === 'prob_water') problem = 'water_quality';
      else if (input.includes('feed') || input === 'prob_feed') problem = 'feed';
      else if (input.includes('slow') || input.includes('growth') || input === 'prob_growth') problem = 'slow_growth';
      else if (input.includes('mortality') || input === 'prob_mortality') problem = 'mortality';
      else if (input.includes('price') || input === 'prob_price') problem = 'price_updates';
      else if (input.includes('weather') || input === 'prob_weather') problem = 'weather_alerts';

      if (!problem) {
        await askGroupQuestion(phone);
        return true;
      }

      updateStateData(phone, { current_problem: problem });

      // All groups done → finalize
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

  // GROUP 1
  if (group === 1) {
    if (step === 0) {
      await sendButtonMessage(phone,
        '🌊 What do you farm?',
        [
          { id: 'farm_shrimp', title: '🦐 Shrimp' },
          { id: 'farm_fish', title: '🐟 Fish' },
          { id: 'farm_both', title: '🦐🐟 Both' },
        ]
      );
      return;
    }
    if (step === 1) {
      await sendTextMessage(phone, '📍 Which village or town are you from?');
      return;
    }
    if (step === 2) {
      await sendButtonMessage(phone,
        '🏊 How many ponds do you have?',
        [
          { id: 'ponds_1', title: '1' },
          { id: 'ponds_2', title: '2' },
          { id: 'ponds_3', title: '3 or more' },
        ]
      );
      return;
    }
  }

  // GROUP 2
  if (group === 2) {
    if (step === 0) {
      await sendListMessage(phone,
        '🐟 What species are you growing?',
        'Select Species',
        [{
          title: 'Species',
          rows: [
            { id: 'sp_vannamei', title: 'Vannamei Shrimp' },
            { id: 'sp_tiger', title: 'Tiger Shrimp' },
            { id: 'sp_tilapia', title: 'Tilapia' },
            { id: 'sp_rohu', title: 'Rohu' },
            { id: 'sp_catla', title: 'Catla' },
            { id: 'sp_other', title: 'Other' },
          ],
        }]
      );
      return;
    }
    if (step === 1) {
      await sendButtonMessage(phone,
        '📅 When did you stock this pond?',
        [
          { id: 'stock_week', title: 'This week' },
          { id: 'stock_month', title: 'This month' },
          { id: 'stock_3plus', title: '1+ months ago' },
        ]
      );
      return;
    }
    if (step === 2) {
      await sendButtonMessage(phone,
        '📐 What is the pond size?',
        [
          { id: 'size_small', title: 'Less than 1 acre' },
          { id: 'size_medium', title: '1–3 acres' },
          { id: 'size_large', title: 'More than 3 acres' },
        ]
      );
      return;
    }
  }

  // GROUP 3
  if (group === 3) {
    if (step === 0) {
      await sendListMessage(phone,
        '💡 What do you want help with today?\n\nThis helps me give you the right advice right away.',
        'Select Topic',
        [{
          title: 'Help Topics',
          rows: [
            { id: 'prob_disease', title: '🔬 Disease', description: 'Disease detection & prevention' },
            { id: 'prob_water', title: '💧 Water Quality', description: 'Water management advice' },
            { id: 'prob_feed', title: '🍽️ Feed', description: 'Feed management tips' },
            { id: 'prob_growth', title: '📈 Slow Growth', description: 'Growth & weight concerns' },
            { id: 'prob_mortality', title: '⚠️ Mortality', description: 'Dealing with losses' },
            { id: 'prob_price', title: '💰 Price Updates', description: 'Market price info' },
            { id: 'prob_weather', title: '🌤️ Weather Alerts', description: 'Weather & rain alerts' },
          ],
        }]
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

  // Update farmer record
  await updateFarmer(state.farmerId, {
    village: data.village,
    farm_type: data.farm_type,
    preferred_language: data.preferred_language,
    pond_count: data.pond_count,
    current_problem: data.current_problem,
    onboarding_complete: true,
    onboarding_day: 1,
  });

  // Create first pond
  const pond = await createPond({
    farmer_id: state.farmerId,
    pond_number: 1,
    species: data.species,
    stocking_date: data.stocking_date,
    pond_size: data.pond_size,
  });

  clearState(phone);

  // Send confirmation
  const speciesLabel = getSpeciesLabel(data.species);
  const sizeLabel = getSizeLabel(data.pond_size);

  await sendTextMessage(phone,
    `✅ *All set!*\n\n` +
    `🌊 Farm: ${capitalize(data.farm_type)}\n` +
    `📍 Village: ${data.village}\n` +
    `🐟 Species: ${speciesLabel}\n` +
    `📐 Size: ${sizeLabel}\n\n` +
    `Let me get some useful info for you right away! 👇`
  );

  // Deliver immediate value
  await deliverImmediateValue(phone, state.farmerId, data.village, data.current_problem, data.preferred_language);
}

// ========================
// HELPERS
// ========================

function getGroupIntro(group, lang) {
  // Keeping English for MVP. In production, translate based on lang.
  if (group === 1) return '👋 Let\'s get started! Just 3 quick questions about your farm.';
  if (group === 2) return '📋 Great! Now tell me about your pond.';
  if (group === 3) return '🎯 Last question!';
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

function getSizeLabel(size) {
  const labels = {
    less_than_1_acre: 'Less than 1 acre',
    '1_3_acres': '1–3 acres',
    more_than_3_acres: 'More than 3 acres',
  };
  return labels[size] || size;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

module.exports = {
  startOnboarding,
  handleOnboardingStep,
};
