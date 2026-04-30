const { getRecentPondLogs, upsertHealthScore, getLatestHealthScore } = require('../models/database');
const { getWeather } = require('./weather');

/**
 * Pond Health Score Calculator
 *
 * Simple 🟢/🟡/🔴 scoring based on recent pond data.
 * Score = worst individual factor.
 *
 * Factors evaluated:
 *  - Feed pattern (from feed logs)
 *  - Water condition (from water logs)
 *  - Disease signs (from health logs / events)
 *  - Growth status (from health/weekly logs)
 *  - Weather risk (from weather API — auto-collected)
 *
 * We do NOT use mortality as a proactive factor.
 * Mortality is only tracked when the farmer reports it via event follow-up.
 */

// ========================
// CALCULATE HEALTH SCORE
// ========================

async function calculateHealthScore(pondId) {
  try {
    // Get recent logs (last 7 days)
    const recentLogs = await getRecentPondLogs(pondId, null, 20);

    // Separate by group
    const feedLogs = recentLogs.filter(l => l.log_group === 'feed');
    const waterLogs = recentLogs.filter(l => l.log_group === 'water');
    const healthLogs = recentLogs.filter(l => l.log_group === 'health');
    const eventLogs = recentLogs.filter(l => l.log_group === 'event');
    const weeklyLogs = recentLogs.filter(l => l.log_group === 'weekly');

    // Evaluate each factor
    const factors = {};

    // Feed factor
    factors.feed = evaluateFeed(feedLogs, weeklyLogs);

    // Water factor
    factors.water = evaluateWater(waterLogs, weeklyLogs);

    // Disease factor
    factors.disease = evaluateDisease(healthLogs, weeklyLogs, eventLogs);

    // Growth factor
    factors.growth = evaluateGrowth(healthLogs, weeklyLogs);

    // Overall score = worst factor
    const scores = Object.values(factors);
    let overallScore = 'green';
    if (scores.includes('red')) overallScore = 'red';
    else if (scores.includes('yellow')) overallScore = 'yellow';

    // Save to DB
    await upsertHealthScore(pondId, overallScore, factors);

    return { score: overallScore, factors };

  } catch (error) {
    console.error('❌ Health score calculation failed:', error.message);
    return null;
  }
}

// ========================
// FACTOR EVALUATORS
// ========================

function evaluateFeed(feedLogs, weeklyLogs) {
  if (feedLogs.length === 0 && weeklyLogs.length === 0) return 'green'; // no data = assume ok

  // Check last feed log
  const lastFeed = feedLogs[0];
  if (lastFeed) {
    const data = lastFeed.log_data;
    // Very low feed could indicate problems
    if (data.feed_kg === '<10') return 'yellow';
  }

  // Check weekly
  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.feed_used === '<50') return 'yellow'; // might be normal for small ponds
  }

  return 'green';
}

function evaluateWater(waterLogs, weeklyLogs) {
  // Check last water log
  const lastWater = waterLogs[0];
  if (lastWater) {
    const data = lastWater.log_data;
    if (data.water_color === 'brown_black') return 'red';
    if (data.bad_smell === 'strong') return 'red';
    if (data.water_color === 'dark_green') return 'yellow';
    if (data.bad_smell === 'mild') return 'yellow';
    if (data.foam_bubbles === 'yes') return 'yellow';
  }

  // Check weekly
  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.water_changes === 'smell_foam') return 'red';
    if (data.water_changes === 'color_changed') return 'yellow';
  }

  return 'green';
}

function evaluateDisease(healthLogs, weeklyLogs, eventLogs) {
  // Check event logs (farmer-reported problems)
  const diseaseEvents = eventLogs.filter(e => {
    const data = e.log_data;
    return data.event_type === 'disease' || data.event_type === 'mortality';
  });

  if (diseaseEvents.length > 0) {
    // Recent disease/mortality event = red
    const latestEvent = diseaseEvents[0];
    const eventAge = Date.now() - new Date(latestEvent.created_at).getTime();
    const daysSince = eventAge / (1000 * 60 * 60 * 24);

    if (daysSince <= 3) return 'red';
    if (daysSince <= 7) return 'yellow';
  }

  // Check health check-in logs
  const lastHealth = healthLogs[0];
  if (lastHealth) {
    const data = lastHealth.log_data;
    if (data.disease_signs && data.disease_signs !== 'none') {
      if (data.disease_signs === 'white_spots') return 'red';
      return 'yellow';
    }
  }

  // Check weekly
  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.disease_signs === 'yes') return 'yellow';
  }

  return 'green';
}

function evaluateGrowth(healthLogs, weeklyLogs) {
  // Check health check-in
  const lastHealth = healthLogs[0];
  if (lastHealth) {
    const data = lastHealth.log_data;
    if (data.growth_status === 'slow') return 'yellow';
  }

  // Check weekly
  const lastWeekly = weeklyLogs[0];
  if (lastWeekly) {
    const data = lastWeekly.log_data;
    if (data.growth_status === 'slow') return 'yellow';
  }

  return 'green';
}

// ========================
// FORMAT HEALTH SCORE MESSAGE
// ========================

function formatHealthScoreMessage(scoreData) {
  if (!scoreData) return '📊 No health data yet. Complete a check-in to see your pond score!';

  const { score, factors } = scoreData;

  const emoji = score === 'green' ? '🟢' : score === 'yellow' ? '🟡' : '🔴';
  const label = score === 'green' ? 'Healthy' : score === 'yellow' ? 'Watch Closely' : 'High Risk';

  let msg = `${emoji} *Pond Health: ${label}*\n\n`;

  for (const [factor, value] of Object.entries(factors)) {
    const fEmoji = value === 'green' ? '🟢' : value === 'yellow' ? '🟡' : '🔴';
    const fLabel = factor.charAt(0).toUpperCase() + factor.slice(1);
    msg += `${fEmoji} ${fLabel}\n`;
  }

  if (score === 'red') {
    msg += '\n⚠️ *Action needed!* Check the red factors above and take immediate steps.';
  } else if (score === 'yellow') {
    msg += '\n💡 Some factors need attention. Keep monitoring closely.';
  } else {
    msg += '\n✅ Everything looks good! Keep up the great work.';
  }

  return msg;
}

module.exports = {
  calculateHealthScore,
  formatHealthScoreMessage,
};
