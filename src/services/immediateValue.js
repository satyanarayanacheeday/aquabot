const { sendTextMessage } = require('./whatsapp');
const { getWeather } = require('./weather');

/**
 * Deliver immediate value right after onboarding.
 * Makes the farmer feel: "This assistant is helping me immediately."
 *
 * Shows:
 *  - Today's weather for their village
 *  - Problem-specific advice based on what they selected
 *  - 2-3 action items
 */
async function deliverImmediateValue(phone, farmerId, village, currentProblem, language = 'English') {
  try {
    // 1. Get weather
    let weatherMsg = '';
    try {
      const weather = await getWeather(village);
      if (weather) {
        weatherMsg = `☀️ *Weather in ${weather.location}*\n` +
          `🌡️ ${weather.temperature}°C | 💧 ${weather.humidity}% humidity`;

        if (weather.rainfall > 0) {
          weatherMsg += ` | 🌧️ Rain: ${weather.rainfall}mm/h`;
        }

        weatherMsg += `\n${weather.description}\n`;

        if (weather.rainfall > 5) {
          weatherMsg += `\n⚠️ *Heavy rain alert!* Watch your DO levels and reduce feeding by 20-30%.\n`;
        }
        if (weather.temperature > 33) {
          weatherMsg += `\n⚠️ *High temperature!* Watch for pH spikes and algae blooms.\n`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Weather fetch failed:', err.message);
    }

    // 2. Get problem-specific advice
    const problemLabel = getProblemLabel(currentProblem);
    let adviceMsg = '';

    // Try AI-generated advice if Gemini is configured
    if (process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')) {
      try {
        const { answerQuestion } = require('./ai');
        const prompt = `A farmer just registered. They farm in ${village} and their main concern is: ${problemLabel}.\n\n` +
          `Give 2-3 specific, immediately useful tips. Keep it very short (max 100 words), practical, and encouraging. ` +
          `Format for WhatsApp with emojis.`;
        adviceMsg = await answerQuestion(prompt, farmerId, language);
      } catch (err) {
        console.warn('⚠️ AI advice failed:', err.message);
        adviceMsg = getDefaultAdvice(currentProblem);
      }
    } else {
      adviceMsg = getDefaultAdvice(currentProblem);
    }

    // 3. Combine and send
    let fullMessage = '';
    if (weatherMsg) fullMessage += weatherMsg + '\n';
    fullMessage += `💡 *Quick tips for ${problemLabel}:*\n\n${adviceMsg}`;
    fullMessage += `\n\n---\nI'll check in with you regularly to help manage your pond! 🦐\nType *help* anytime to see what I can do.`;

    await sendTextMessage(phone, fullMessage);

  } catch (error) {
    console.error('❌ Immediate value delivery failed:', error.message);
    // Non-critical — don't throw. At minimum send a welcome.
    try {
      await sendTextMessage(phone,
        `🦐 Welcome aboard! I'll be your pond assistant.\n\n` +
        `Type *help* to see what I can do.\n` +
        `Type *update* to log pond data.\n` +
        `Type *weather* for local weather.\n` +
        `Send a 📸 photo for disease detection.`
      );
    } catch (e) {
      // ignore
    }
  }
}

function getProblemLabel(problem) {
  const labels = {
    disease: 'Disease detection & prevention',
    water_quality: 'Water quality management',
    feed: 'Feed management',
    slow_growth: 'Slow growth concerns',
    mortality: 'Mortality concerns',
    price_updates: 'Market price updates',
    weather_alerts: 'Weather & rain alerts',
  };
  return labels[problem] || 'General pond management';
}

function getDefaultAdvice(problem) {
  const defaults = {
    disease: '🔬 Check for white spots, red body, or unusual behavior daily.\n💊 Maintain good water quality — it\'s the best prevention.\n🧪 Keep DO above 5 mg/L and pH between 7.5-8.5.',
    water_quality: '💧 Check water color daily — green is good, dark/brown needs attention.\n🫧 Keep aerators running, especially at night.\n🧪 Ideal: DO > 5 mg/L, pH 7.5-8.5.',
    feed: '🍽️ Don\'t overfeed — leftover feed pollutes water.\n📊 Reduce feed by 20% during cloudy/rainy days.\n⏰ Feed 3-4 times daily at fixed times.',
    slow_growth: '📈 Check if feed amount matches shrimp/fish size.\n💧 Poor water quality often causes slow growth.\n🧪 Check ammonia — high levels reduce growth.',
    mortality: '⚠️ Check water quality immediately — DO, pH, ammonia.\n🔍 Look for disease signs: white spots, red body, white gut.\n🫧 Increase aeration right away.',
    price_updates: '💰 Track local mandi prices regularly.\n📊 Harvest at optimal size for best price.\n🤝 Connect with multiple buyers for better rates.',
    weather_alerts: '🌧️ Reduce feeding by 20-30% during heavy rain.\n🫧 Run aerators extra during cloudy weather.\n🌡️ Watch for temperature swings after rain.',
  };
  return defaults[problem] || '💡 Keep monitoring your pond daily.\n💧 Good water quality is the foundation of healthy farming.';
}

module.exports = {
  deliverImmediateValue,
};
