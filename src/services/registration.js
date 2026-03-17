const { sendTextMessage, sendButtonMessage } = require('./whatsapp');
const { createFarmer, updateFarmer, getFarmerByPhone } = require('../models/database');
const { createFarm } = require('../models/database');
const { setState, getState, clearState, updateStateData } = require('../state/conversationState');

/**
 * Registration flow steps:
 * 0: Ask language
 * 1: Ask name
 * 2: Ask village/location
 * 3: Ask pond size
 * 4: Ask number of ponds
 * 5: Ask species (Vannamei / Fish)
 * 6: Ask stocking date
 * 7: Ask PL count (seed count)
 * 8: Save and confirm
 */

const REGISTRATION_STEPS = [
  {
    key: 'preferred_language',
    prompt: null, // button message
    validate: () => true,
  },
  {
    key: 'name',
    prompt: '👤 What is your name?',
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: 'Please enter a valid name (at least 2 characters).',
  },
  {
    key: 'location',
    prompt: '📍 What is your village or location?',
    validate: (v) => v && v.trim().length >= 2,
    errorMsg: 'Please enter a valid location.',
  },
  {
    key: 'pond_size',
    prompt: '📐 What is your pond size? (e.g., "1 acre", "0.5 hectare")',
    validate: (v) => v && v.trim().length >= 1,
    errorMsg: 'Please enter a valid pond size.',
    transform: (v) => {
      let val = v.toLowerCase().trim();
      // Handle numeric only input
      if (/^\d+(\.\d+)?$/.test(val)) {
        return val + ' acre';
      }
      // Correct common typos for acres
      val = val.replace(/\b(achers?|accur|acr|akres?)\b/g, 'acres');
      // Correct common typos for hectares
      val = val.replace(/\b(hecters?|hect|hac)\b/g, 'hectares');
      return val;
    }
  },
  {
    key: 'species',
    prompt: null, // handled as button message
    validate: () => true,
  },
  {
    key: 'stocking_date',
    prompt: '📅 When did you stock? (e.g., "15 March 2025" or "2025-03-15")',
    validate: (v) => v && v.trim().length >= 4,
    errorMsg: 'Please enter a valid date.',
  },
  {
    key: 'pl_count',
    prompt: '🦐 How many PL/seeds did you stock? (e.g., 100000)',
    validate: (v) => {
      const num = parseInt(v.replace(/,/g, ''), 10);
      return !isNaN(num) && num > 0;
    },
    errorMsg: 'Please enter a valid number.',
    transform: (v) => parseInt(v.replace(/,/g, ''), 10),
  },
];

/**
 * Start the registration flow for a new farmer
 */
async function startRegistration(phone) {
  // Create a placeholder farmer record
  let farmer = await getFarmerByPhone(phone);
  if (!farmer) {
    farmer = await createFarmer({ phone, registration_complete: false });
  }

  setState(phone, {
    flow: 'registration',
    step: 0,
    data: {},
    farmerId: farmer.id,
    farmId: null,
  });

  await askNextStep(phone);
}

/**
 * Process user's reply during registration flow
 */
async function handleRegistrationStep(phone, message) {
  const state = getState(phone);
  if (!state || state.flow !== 'registration') return false;

  const stepIndex = state.step;

  // Handle language step (button response)
  if (stepIndex === 0) {
    const input = message.toLowerCase().trim();
    let lang = null;

    if (input.includes('english') || input === 'btn_en') {
      lang = 'English';
    } else if (input.includes('telugu') || input.includes('తెలుగు') || input === 'btn_te') {
      lang = 'Telugu';
    } else if (input.includes('hindi') || input.includes('हिंदी') || input === 'btn_hi') {
      lang = 'Hindi';
    }

    if (!lang) {
      await sendButtonMessage(phone,
        'Please select your preferred language:\nమీకు ఇష్టమైన భాషను ఎంచుకోండి:\nअपनी पसंदीदा भाषा चुनें:',
        [
          { id: 'btn_en', title: 'English' },
          { id: 'btn_te', title: 'Telugu' },
          { id: 'btn_hi', title: 'Hindi' },
        ]
      );
      return true;
    }

    updateStateData(phone, { preferred_language: lang });
    await askNextStep(phone);
    return true;
  }

  // Handle species step (button response)
  if (stepIndex === 4) {
    const input = message.toLowerCase().trim();
    let species = null;

    if (input.includes('vannamei') || input.includes('shrimp') || input === 'btn_vannamei') {
      species = 'Vannamei Shrimp';
    } else if (input.includes('fish') || input === 'btn_fish') {
      species = 'Fish';
    } else if (input.includes('both') || input === 'btn_both') {
      species = 'Both';
    }

    if (!species) {
      await sendButtonMessage(phone,
        'Please select your species type:',
        [
          { id: 'btn_vannamei', title: 'Vannamei Shrimp' },
          { id: 'btn_fish', title: 'Fish' },
          { id: 'btn_both', title: 'Both' },
        ]
      );
      return true;
    }

    updateStateData(phone, { species });
    await askNextStep(phone);
    return true;
  }

  // Handle regular text steps
  if (stepIndex < REGISTRATION_STEPS.length) {
    const stepDef = REGISTRATION_STEPS[stepIndex];
    const value = message.trim();

    if (!stepDef.validate(value)) {
      await sendTextMessage(phone, stepDef.errorMsg);
      return true;
    }

    const transformedValue = stepDef.transform ? stepDef.transform(value) : value;
    updateStateData(phone, { [stepDef.key]: transformedValue });
    await askNextStep(phone);
    return true;
  }

  return false;
}

/**
 * Ask the next registration question or finalize
 */
async function askNextStep(phone) {
  const state = getState(phone);
  const stepIndex = state.step;

  // All steps done → save to DB
  if (stepIndex >= REGISTRATION_STEPS.length) {
    await finalizeRegistration(phone);
    return;
  }

  // Language step
  if (stepIndex === 0) {
    await sendButtonMessage(phone,
      'Welcome to *Aquorix* 🦐🐟\nYour Smart Pond Assistant!\n\nPlease select your preferred language:\nమీకు ఇష్టమైన భాషను ఎంచుకోండి:\nअपनी पसंदीदा भाषा चुनें:',
      [
        { id: 'btn_en', title: 'English' },
        { id: 'btn_te', title: 'Telugu' },
        { id: 'btn_hi', title: 'Hindi' },
      ]
    );
    return;
  }

  // Species step
  if (stepIndex === 4) {
    await sendButtonMessage(phone,
      '🐟 What species do you farm?',
      [
        { id: 'btn_vannamei', title: 'Vannamei Shrimp' },
        { id: 'btn_fish', title: 'Fish' },
        { id: 'btn_both', title: 'Both' },
      ]
    );
    return;
  }

  // Regular text step
  const promptText = REGISTRATION_STEPS[stepIndex].prompt;
  const lang = state.data.preferred_language || 'English';
  
  // NOTE: In a real app we'd translate these prompts. For MVP we send English since translations weren't provided.
  await sendTextMessage(phone, promptText);
}

/**
 * Save registration data and confirm
 */
async function finalizeRegistration(phone) {
  const state = getState(phone);
  const data = state.data;

  // Update farmer record
  await updateFarmer(state.farmerId, {
    name: data.name,
    location: data.location,
    preferred_language: data.preferred_language,
    registration_complete: true,
  });

  // Create farm record
  const farm = await createFarm({
    farmer_id: state.farmerId,
    pond_size: data.pond_size,
    number_of_ponds: 1, // Defaulting to 1 as requested
    species: data.species,
    stocking_date: data.stocking_date,
    pl_count: data.pl_count,
  });

  clearState(phone);

  const confirmationMsg = `✅ *Farm registered successfully!*\n\n` +
    `👤 Name: ${data.name}\n` +
    `📍 Location: ${data.location}\n` +
    `🌐 Language: ${data.preferred_language}\n` +
    `📐 Pond Size: ${data.pond_size}\n` +
    `🐟 Species: ${data.species}\n` +
    `📅 Stocking: ${data.stocking_date}\n` +
    `🦐 PL Count: ${(data.pl_count || 0).toLocaleString()}\n\n` +
    `You can now:\n` +
    `• Ask farming questions anytime\n` +
    `• Send shrimp photos for disease detection\n` +
    `• Receive daily pond management tips\n\n` +
    `Just type your question! 💬`;

  await sendTextMessage(phone, confirmationMsg);
}

module.exports = {
  startRegistration,
  handleRegistrationStep,
};
