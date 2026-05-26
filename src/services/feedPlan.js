const { getFirstPondByFarmer, getRecentPondLogs } = require('../models/database');

/**
 * Feed Plan Service
 * 
 * Calculates feeding requirements and provides a structured response.
 * Adjusts for disease, water quality, and mortality.
 */

const GROWTH_CURVES = {
  vannamei: [
    { doc: 0, abw: 0.001, rate: 100 },
    { doc: 15, abw: 0.1, rate: 12 },
    { doc: 30, abw: 2.0, rate: 7 },
    { doc: 45, abw: 10, rate: 4 },
    { doc: 60, abw: 18, rate: 2.5 },
    { doc: 90, abw: 28, rate: 2.0 },
    { doc: 120, abw: 36, rate: 1.6 }


  ],
  tiger_shrimp: [
    { doc: 0, abw: 0.01, rate: 15 },
    { doc: 30, abw: 1, rate: 10 },
    { doc: 60, abw: 8, rate: 6 },
    { doc: 90, abw: 18, rate: 4 },
    { doc: 120, abw: 35, rate: 3 }
  ],
  fish: [
    { doc: 0, abw: 1, rate: 5 },
    { doc: 30, abw: 50, rate: 3 },
    { doc: 60, abw: 150, rate: 2.5 },
    { doc: 90, abw: 350, rate: 2 },
    { doc: 150, abw: 800, rate: 1.5 }
  ]
};

/**
 * Estimate ABW (Average Body Weight) based on species and DOC
 */
function estimateABW(species, doc) {
  let curve = GROWTH_CURVES.vannamei;
  if (species.toLowerCase().includes('tiger')) curve = GROWTH_CURVES.tiger_shrimp;
  if (species.toLowerCase().includes('fish') || species.toLowerCase().includes('rohu') || species.toLowerCase().includes('tilapia')) curve = GROWTH_CURVES.fish;

  for (let i = 0; i < curve.length - 1; i++) {
    if (doc >= curve[i].doc && doc <= curve[i + 1].doc) {
      const ratio = (doc - curve[i].doc) / (curve[i + 1].doc - curve[i].doc);
      return curve[i].abw + ratio * (curve[i + 1].abw - curve[i].abw);
    }
  }
  return curve[curve.length - 1].abw;
}

/**
 * Get feeding rate (% of biomass) based on ABW
 */
function getFeedingRate(species, abw) {
  if (species.toLowerCase().includes('fish')) {
    if (abw < 10) return 5;
    if (abw < 100) return 3;
    if (abw < 500) return 2;
    return 1.5;
  }
  
  // Shrimp rates (Vannamei/Tiger) — High-intensity standards
  if (abw < 0.1) return 12;
  if (abw < 1) return 8;
  if (abw < 5) return 5;
  if (abw < 12) return 3.2; // 10g around 3.2%
  if (abw < 20) return 2.5;
  if (abw < 30) return 1.8;
  return 1.4;


}

/**
 * Generate the feed plan
 * @param {string} farmerId
 * @param {string} lang
 * @param {number} [userABW] - Optional user-provided Average Body Weight in grams
 */
async function getFeedPlan(farmerId, lang = 'English', userABW = null) {

  const pond = await getFirstPondByFarmer(farmerId);
  if (!pond) return null;

  // 1. Check for Seed Count
  if (!pond.seed_count) {
    return {
      type: 'missing_data',
      message: t('err_missing_count', lang),
    };
  }

  // 1.5 Check for Feed Brand (Optional but helpful)
  const feedBrand = pond.feed_brand || null;


  // 2. Calculate DOC (from exact date or category fallback)
  let doc = 30;
  if (pond.stocking_date && pond.stocking_date.includes('-')) {
    const stockDate = new Date(pond.stocking_date);
    const diffTime = Math.abs(new Date() - stockDate);
    doc = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } else {
    // Fallback for old categorical data
    if (pond.stocking_date === 'this_week') doc = 5;
    else if (pond.stocking_date === 'this_month') doc = 15;
    else if (pond.stocking_date === '1_2_months') doc = 45;
    else if (pond.stocking_date === '3_plus_months') doc = 90;
  }

  // 3. Estimate Mortality from logs
  let totalMortality = 0;
  try {
    const mortLogs = await getRecentPondLogs(pond.id, 'event', 20);
    mortLogs.forEach(log => {
      if (log.log_data.event_type === 'mortality') {
        // Map buckets to conservative estimates
        let qty = 0;
        if (log.log_data.how_many === '1-50') qty = 25;
        else if (log.log_data.how_many === '50-100') qty = 75;
        else if (log.log_data.how_many === '100+') qty = 250; 
        totalMortality += qty;
      }
    });

  } catch (err) {
    console.warn('⚠️ Error estimating mortality:', err.message);
  }

  // 4. Calculate Estimates
  // If user provided ABW, use it. Otherwise, estimate from curve.
  const abw = userABW || estimateABW(pond.species, doc);
  const isEstimate = !userABW;

  const count = pond.seed_count;
  const survival = Math.max(0.5, (count - totalMortality) / count); // Floor at 50% for safety
  const biomassKg = (count * survival * abw) / 1000;
  const baseRate = getFeedingRate(pond.species, abw);
  
  let currentRate = baseRate;
  let adjustments = [];

  // 5. Adjust for Water & Disease
  try {
    const recentLogs = await getRecentPondLogs(pond.id, null, 5);
    
    // Water check
    const waterLog = recentLogs.find(l => l.log_group === 'water' || l.log_group === 'event' && l.log_data.event_type === 'water_quality');
    if (waterLog) {
      const data = waterLog.log_data;
      if (data.water_color === 'brown_black' || data.bad_smell === 'strong' || data.smell_foam === 'bad_smell') {
        currentRate *= 0.7; // 30% reduction
        adjustments.push(t('adj_water_poor', lang));
      }
    }

    // Disease check
    const healthLog = recentLogs.find(l => l.log_group === 'health' || l.log_group === 'event' && (l.log_data.event_type === 'disease' || l.log_data.event_type === 'mortality'));
    if (healthLog) {
      const data = healthLog.log_data;
      if (data.disease_signs !== 'none' || data.event_type === 'mortality') {
        currentRate *= 0.5; // 50% reduction
        adjustments.push(t('adj_disease', lang));
      }
      if (data.disease_signs === 'white_spots' || data.body_signs === 'white_spots') {
        currentRate = 0; // Stop feed
        adjustments.push(t('adj_wssv', lang));
      }
    }

    // 5.5 Environment Check (Mocked/Logic-based)
    // In a production app, we would fetch weather API here.
    // For now, we check if the user reported "Heavy Rain" or "Extreme Heat" in any log.
    const envLog = recentLogs.find(l => l.log_data && (l.log_data.weather === 'heavy_rain' || l.log_data.temp === 'high'));
    if (envLog) {
      currentRate *= 0.8; // 20% reduction
      adjustments.push(t('adj_weather', lang));
    }
  } catch (err) {
    console.warn('⚠️ Error adjusting feed plan:', err.message);
  }


  const dailyFeedKg = (biomassKg * currentRate) / 100;
  const meals = (pond.species.toLowerCase().includes('fish')) ? 2 : (doc < 30 ? 4 : 3);
  const feedPerMeal = dailyFeedKg / meals;

  // 5.5 Persist Calculation to Database
  try {
    const { insertPondLog } = require('../models/database');
    await insertPondLog({
      pond_id: pond.id,
      log_group: 'feed_plan',
      log_data: {
        doc,
        abw,
        survival,
        biomass_kg: biomassKg,
        daily_feed_kg: dailyFeedKg,
        rate: currentRate,
        adjustments: adjustments.length
      }
    });
  } catch (err) {
    console.warn('⚠️ Could not save feed plan log:', err.message);
  }

  // 6. Build the message

  let response = `🍽️ *${t('title_feed_plan', lang)}*\n\n`;
  let pondContext = t('context_pond', lang).replace('{pond}', pond.pond_number || 1).replace('{species}', pond.species);
  if (feedBrand) {
    pondContext += ` (${feedBrand} ${t('label_feed', lang)})`;
  }
  response += `${pondContext}\n`;

  response += `${t('label_doc', lang)}: ~${doc} days\n\n`;
  
  response += `📏 *${t('title_estimates', lang)}:*\n`;
  response += `- ${t('label_abw', lang)}: ~${abw.toFixed(2)}g ${isEstimate ? '(Benchmark)' : '(Actual)'}\n`;
  response += `- ${t('label_survival', lang)}: ~${(survival * 100).toFixed(0)}%\n`;
  response += `- ${t('label_biomass', lang)}: ~${biomassKg.toFixed(0)} kg\n\n`;


  response += `📊 *${t('title_recommendation', lang)}:*\n`;
  response += `- *${t('label_total_feed', lang)}: ${dailyFeedKg.toFixed(1)} kg*\n`;
  response += `- ${t('label_rate', lang)}: ${currentRate.toFixed(1)}% ${t('of_biomass', lang)}\n`;
  response += `- ${t('label_meals', lang)}: ${meals} ${t('meals_of', lang)} ${feedPerMeal.toFixed(1)} kg\n\n`;

  if (adjustments.length > 0) {
    response += `⚠️ *${t('title_adjustments', lang)}:*\n`;
    adjustments.forEach(adj => response += `👉 ${adj}\n`);
    response += `\n`;
  }

  response += `💡 *${t('label_tip', lang)}:* ${t('feed_tip', lang)}\n\n`;
  response += `⚠️ _${t('label_caution', lang)}: ${t('feed_caution', lang)}_`;

  return {
    type: 'success',
    message: response,
    data: { dailyFeedKg, biomassKg, abw, survival, doc }
  };
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    title_feed_plan: 'Your Daily Feed Plan',
    context_pond: 'Based on Pond {pond} ({species}):',
    label_doc: 'DOC (Days of Culture)',
    label_feed: 'Feed',
    title_estimates: 'Current Estimates',

    label_abw: 'Estimated ABW',
    label_survival: 'Estimated Survival',
    label_biomass: 'Estimated Biomass',
    title_recommendation: 'Feeding Recommendation',
    label_total_feed: 'Total Daily Feed',
    label_rate: 'Feeding Rate',
    of_biomass: 'of biomass',
    label_meals: 'Schedule',
    meals_of: 'meals of',
    title_adjustments: 'Adjustments Applied',
    adj_water_poor: 'Reduced due to poor water quality',
    adj_disease: 'Reduced due to disease/mortality signs',
    adj_wssv: 'STOP FEEDING: Severe risk detected',
    adj_weather: 'Reduced due to extreme weather/heat',

    label_tip: 'Expert Tip',
    feed_tip: 'Check trays after 1 hour. If empty in <30 min, increase next meal by 10%.',
    label_caution: 'Caution',
    feed_caution: 'Verify these estimates with a local expert.',
    err_missing_count: '🔢 I need your *stocking count* to calculate a feed plan. How many seeds did you stock in this pond?',
  },
  Telugu: {
    title_feed_plan: 'మీ రోజువారీ మేత ప్రణాళిక',
    context_pond: 'చెరువు {pond} ({species}) ఆధారంగా:',
    label_doc: 'DOC (సాగు రోజులు)',
    label_feed: 'మేత',
    title_estimates: 'ప్రస్తుత అంచనాలు',

    label_abw: 'అంచనా వేసిన బరువు (ABW)',
    label_survival: 'అంచనా వేసిన మనుగడ',
    label_biomass: 'అంచనా వేసిన బయోమాస్',
    title_recommendation: 'మేత సిఫార్సు',
    label_total_feed: 'మొత్తం రోజువారీ మేత',
    label_rate: 'మేత రేటు',
    of_biomass: 'బయోమాస్‌లో',
    label_meals: 'షెడ్యూల్',
    meals_of: 'సార్లు, ఒక్కోసారి',
    title_adjustments: 'చేసిన మార్పులు',
    adj_water_poor: 'నీటి నాణ్యత తక్కువగా ఉన్నందున తగ్గించబడింది',
    adj_disease: 'వ్యాధి/మరణాల లక్షణాల వల్ల తగ్గించబడింది',
    adj_wssv: 'మేత ఆపివేయండి: తీవ్రమైన ప్రమాదం గుర్తించబడింది',
    adj_weather: 'తీవ్రమైన వాతావరణం/వేడి వల్ల తగ్గించబడింది',

    label_tip: 'చిట్కా',
    feed_tip: '1 గంట తర్వాత ట్రేలను తనిఖీ చేయండి. 30 నిమిషాల కంటే తక్కువ సమయంలో ఖాళీ అయితే, తదుపరి సారి 10% పెంచండి.',
    label_caution: 'హెచ్చరిక',
    feed_caution: 'ఈ అంచనాలను స్థానిక నిపుణుడితో ధృవీకరించుకోండి.',
    err_missing_count: '🔢 మేత ప్రణాళికను లెక్కించడానికి నాకు మీ *స్టాకింగ్ కౌంట్* అవసరం. మీరు ఈ చెరువులో ఎన్ని విత్తనాలు (seeds) వేశారు?',
  },
  Hindi: {
    title_feed_plan: 'आपकी दैनिक चारा योजना',
    context_pond: 'तालाब {pond} ({species}) के आधार पर:',
    label_doc: 'DOC (खेती के दिन)',
    label_feed: 'चारा',
    title_estimates: 'वर्तमान अनुमान',

    label_abw: 'अनुमानित वजन (ABW)',
    label_survival: 'अनुमानित उत्तरजीविता',
    label_biomass: 'अनुमानित बायोमास',
    title_recommendation: 'चारा सिफारिश',
    label_total_feed: 'कुल दैनिक चारा',
    label_rate: 'चारा दर',
    of_biomass: 'बायोमास का',
    label_meals: 'अनुसूची',
    meals_of: 'बार, हर बार',
    title_adjustments: 'किए गए बदलाव',
    adj_water_poor: 'खराब पानी की गुणवत्ता के कारण कम किया गया',
    adj_disease: 'बीमारी/मृत्यु के लक्षणों के कारण कम किया गया',
    adj_wssv: 'चारा बंद करें: गंभीर जोखिम पाया गया',
    adj_weather: 'अत्यधिक मौसम/गर्मी के कारण कम किया गया',

    label_tip: 'सुझाव',
    feed_tip: '1 घंटे के बाद ट्रे की जांच करें। यदि 30 मिनट से कम समय में खाली हो जाए, तो अगली बार 10% बढ़ा दें।',
    label_caution: 'सावधानी',
    feed_caution: 'इन अनुमानों को स्थानीय विशेषज्ञ से सत्यापित करें।',
    err_missing_count: '🔢 चारा योजना की गणना के लिए मुझे आपकी *स्टॉकिंग संख्या* चाहिए। आपने इस तालाब में कितने बीज डाले थे?',
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

/**
 * Parses user input for count or grams into a valid ABW in grams.
 * Examples: "100 count" -> 10g, "15g" -> 15g, "20" -> 20g (defaults to grams if > 50? No, let's be careful).
 * 
 * @param {string} input 
 * @returns {number|null} - ABW in grams
 */
function parseUserCount(input) {
  if (!input) return null;
  const clean = input.toLowerCase().replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  if (isNaN(num)) return null;

  // If user said "count", convert to grams (1000 / count)
  if (input.toLowerCase().includes('count')) {
    return 1000 / num;
  }

  // If number is > 60, it's likely "count per kg" (e.g., 100 count)
  // If number is < 60, it's likely "grams" (e.g., 15g)
  // This is a heuristic used in Andhra Pradesh farming.
  if (num >= 60) {
    return 1000 / num;
  }

  return num;
}

module.exports = {
  getFeedPlan,
  parseUserCount
};

