const { getRecentPondLogs, upsertHealthScore, getLatestHealthScore } = require('../models/database');

/**
 * Pond Health Score Calculator
 *
 * Numeric 0-100 score + Green/Yellow/Red classification.
 *
 * Score Breakdown (100pts total):
 *  - Feed     = 25 pts
 *  - Water    = 30 pts
 *  - Disease  = 30 pts
 *  - Growth   = 15 pts
 */

// ========================
// CALCULATE HEALTH SCORE
// ========================

async function calculateHealthScore(pondId) {
  try {
    const recentLogs = await getRecentPondLogs(pondId, null, 20);

    const feedLogs    = recentLogs.filter(l => l.log_group === 'feed');
    const waterLogs   = recentLogs.filter(l => l.log_group === 'water');
    const healthLogs  = recentLogs.filter(l => l.log_group === 'health');
    const eventLogs   = recentLogs.filter(l => l.log_group === 'event');
    const weeklyLogs  = recentLogs.filter(l => l.log_group === 'weekly');

    const factors = {};

    factors.feed    = evaluateFeed(feedLogs, weeklyLogs);
    factors.water   = evaluateWater(waterLogs, weeklyLogs);
    factors.disease = evaluateDisease(healthLogs, weeklyLogs, eventLogs);
    factors.growth  = evaluateGrowth(healthLogs, weeklyLogs);

    // Numeric score
    const numericScore = calcNumericScore(factors);

    // Overall colour = worst factor
    const scores = Object.values(factors);
    let overallScore = 'green';
    if (scores.includes('red'))         overallScore = 'red';
    else if (scores.includes('yellow')) overallScore = 'yellow';

    await upsertHealthScore(pondId, overallScore, { ...factors, numericScore });

    return { score: overallScore, factors, numericScore };

  } catch (error) {
    console.error('❌ Health score calculation failed:', error.message);
    return null;
  }
}

// ========================
// NUMERIC SCORER
// ========================

function calcNumericScore(factors) {
  const weights  = { feed: 25, water: 30, disease: 30, growth: 15 };
  const valueMap = { green: 1.0, yellow: 0.5, red: 0.0 };
  let total = 0;
  for (const [factor, colour] of Object.entries(factors)) {
    total += (weights[factor] || 0) * (valueMap[colour] ?? 0);
  }
  return Math.round(total);
}

// ========================
// FACTOR EVALUATORS
// ========================

function evaluateFeed(feedLogs, weeklyLogs) {
  if (feedLogs.length === 0 && weeklyLogs.length === 0) return 'green';

  const lastFeed = feedLogs[0];
  if (lastFeed) {
    const data = lastFeed.log_data;
    if (data.feed_times === 1) return 'red';    // once a day is very poor
    if (data.feed_kg === '<10') return 'yellow';
    if (data.feed_times === 2) return 'yellow';
  }

  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.feed_used === '<50') return 'yellow';
  }

  return 'green';
}

function evaluateWater(waterLogs, weeklyLogs) {
  const lastWater = waterLogs[0];
  if (lastWater) {
    const data = lastWater.log_data;
    if (data.water_color === 'brown_black') return 'red';
    if (data.bad_smell === 'strong')        return 'red';
    if (data.water_color === 'dark_green')  return 'yellow';
    if (data.bad_smell === 'mild')          return 'yellow';
    if (data.foam_bubbles === 'yes')        return 'yellow';
  }

  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.water_changes === 'smell_foam')    return 'red';
    if (data.water_changes === 'color_changed') return 'yellow';
  }

  return 'green';
}

function evaluateDisease(healthLogs, weeklyLogs, eventLogs) {
  const diseaseEvents = eventLogs.filter(e => {
    const data = e.log_data;
    return data.event_type === 'disease' || data.event_type === 'mortality';
  });

  if (diseaseEvents.length > 0) {
    const latestEvent = diseaseEvents[0];
    const eventAge   = Date.now() - new Date(latestEvent.created_at).getTime();
    const daysSince  = eventAge / (1000 * 60 * 60 * 24);
    if (daysSince <= 3) return 'red';
    if (daysSince <= 7) return 'yellow';
  }

  const lastHealth = healthLogs[0];
  if (lastHealth) {
    const data = lastHealth.log_data;
    if (data.disease_signs && data.disease_signs !== 'none') {
      if (data.disease_signs === 'white_spots') return 'red';
      return 'yellow';
    }
  }

  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.disease_signs === 'yes') return 'yellow';
  }

  return 'green';
}

function evaluateGrowth(healthLogs, weeklyLogs) {
  const lastHealth = healthLogs[0];
  if (lastHealth) {
    const data = lastHealth.log_data;
    if (data.growth_status === 'slow') return 'yellow';
  }

  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.growth_status === 'slow') return 'yellow';
  }

  return 'green';
}

// ========================
// FORMAT HEALTH SCORE MESSAGE (Full — for "score" command)
// ========================

function formatHealthScoreMessage(scoreData, lang = 'English') {
  if (!scoreData) return t('msg_no_health_data', lang);

  const { score, factors, numericScore } = scoreData;
  const num = (numericScore !== undefined && numericScore !== null) ? numericScore : calcNumericScore(factors);

  const emoji = score === 'green' ? '🟢' : score === 'yellow' ? '🟡' : '🔴';
  const label = score === 'green'
    ? t('label_healthy', lang)
    : score === 'yellow'
      ? t('label_watch', lang)
      : t('label_high_risk', lang);

  let msg = `${emoji} *${t('label_pond_health', lang)}: ${num}/100 — ${label}*\n\n`;

  for (const [factor, value] of Object.entries(factors)) {
    if (factor === 'numericScore') continue;
    const fEmoji = value === 'green' ? '🟢' : value === 'yellow' ? '🟡' : '🔴';
    const fLabel = t(`label_${factor}`, lang);
    msg += `${fEmoji} ${fLabel}\n`;
  }

  if (score === 'red')         msg += t('msg_action_needed', lang);
  else if (score === 'yellow') msg += t('msg_attention_needed', lang);
  else                         msg += t('msg_everything_good', lang);

  return msg;
}

// ========================
// FORMAT HEALTH SCORE BADGE (Compact — embedded inside check-in completions)
// ========================

/**
 * Returns a compact 1-line badge, e.g.:
 *   🟢 Pond Score: 88/100 Healthy
 *   🟡 Pond Score: 55/100 Caution — Monitor closely
 *   🔴 Pond Score: 15/100 High Risk — Immediate action needed!
 */
function formatHealthScoreBadge(scoreData, lang = 'English') {
  if (!scoreData) return '';

  const { score, factors, numericScore } = scoreData;
  const num = (numericScore !== undefined && numericScore !== null) ? numericScore : calcNumericScore(factors);
  const emoji = score === 'green' ? '🟢' : score === 'yellow' ? '🟡' : '🔴';

  if (lang === 'Telugu') {
    const label  = score === 'green' ? 'ఆరోగ్యంగా ఉంది' : score === 'yellow' ? 'జాగ్రత్తగా ఉండండి' : 'ప్రమాదం';
    const suffix = score === 'yellow' ? ' — నిశితంగా గమనించండి'
                 : score === 'red'    ? ' — తక్షణ చర్య అవసరం!'
                 : '';
    return `${emoji} చెరువు స్కోర్: ${num}/100 — ${label}${suffix}`;
  }

  if (lang === 'Hindi') {
    const label  = score === 'green' ? 'स्वस्थ' : score === 'yellow' ? 'सावधान रहें' : 'उच्च जोखिम';
    const suffix = score === 'yellow' ? ' — बारीकी से निगरानी करें'
                 : score === 'red'    ? ' — तत्काल कार्रवाई जरूरी!'
                 : '';
    return `${emoji} तालाब स्कोर: ${num}/100 — ${label}${suffix}`;
  }

  // English default
  const label  = score === 'green' ? 'Healthy' : score === 'yellow' ? 'Caution' : 'High Risk';
  const suffix = score === 'yellow' ? ' — Monitor closely'
               : score === 'red'    ? ' — Immediate action needed!'
               : '';
  return `${emoji} Pond Score: ${num}/100 — ${label}${suffix}`;
}

// ========================
// TRANSLATIONS
// ========================
const translations = {
  English: {
    msg_no_health_data:  '📊 No health data yet. Complete a check-in to see your pond score!',
    label_healthy:       'Healthy',
    label_watch:         'Watch Closely',
    label_high_risk:     'High Risk',
    label_pond_health:   'Pond Health',
    label_feed:          'Feed',
    label_water:         'Water',
    label_disease:       'Disease',
    label_growth:        'Growth',
    msg_action_needed:   '\n⚠️ *Action needed!* Check the red factors above and take immediate steps.',
    msg_attention_needed:'\n💡 Some factors need attention. Keep monitoring closely.',
    msg_everything_good: '\n✅ Everything looks good! Keep up the great work.'
  },
  Telugu: {
    msg_no_health_data:  '📊 ఇంకా ఆరోగ్య సమాచారం లేదు. మీ చెరువు స్కోర్‌ని చూడటానికి చెక్-ఇన్ పూర్తి చేయండి!',
    label_healthy:       'ఆరోగ్యంగా ఉంది',
    label_watch:         'జాగ్రత్తగా గమనించండి',
    label_high_risk:     'అధిక ప్రమాదం',
    label_pond_health:   'చెరువు ఆరోగ్యం',
    label_feed:          'మేత',
    label_water:         'నీరు',
    label_disease:       'వ్యాధి',
    label_growth:        'పెరుగుదల',
    msg_action_needed:   '\n⚠️ *చర్య అవసరం!* పైన ఉన్న ఎరుపు రంగు అంశాలను తనిఖీ చేయండి మరియు తక్షణ చర్యలు తీసుకోండి.',
    msg_attention_needed:'\n💡 కొన్ని అంశాలపై శ్రద్ధ అవసరం. నిశితంగా గమనిస్తూ ఉండండి.',
    msg_everything_good: '\n✅ అంతా బాగుంది! ఇలాగే కొనసాగించండి.'
  },
  Hindi: {
    msg_no_health_data:  '📊 अभी तक कोई स्वास्थ्य डेटा नहीं है। अपने तालाब का स्कोर देखने के लिए चेक-इन पूरा करें!',
    label_healthy:       'स्वस्थ',
    label_watch:         'बारीकी से देखें',
    label_high_risk:     'उच्च जोखिम',
    label_pond_health:   'तालाब का स्वास्थ्य',
    label_feed:          'चारा',
    label_water:         'पानी',
    label_disease:       'बीमारी',
    label_growth:        'विकास',
    msg_action_needed:   '\n⚠️ *कार्रवाई की आवश्यकता!* ऊपर दिए गए लाल कारकों की जांच करें और तत्काल कदम उठाएं।',
    msg_attention_needed:'\n💡 कुछ कारकों पर ध्यान देने की आवश्यकता है। बारीकी से निगरानी करते रहें।',
    msg_everything_good: '\n✅ सब कुछ अच्छा लग रहा है! शानदार काम जारी रखें।'
  }
};

function t(key, lang = 'English') {
  return translations[lang]?.[key] || translations['English']?.[key] || key;
}

module.exports = {
  calculateHealthScore,
  formatHealthScoreMessage,
  formatHealthScoreBadge,
  translations,
  t
};
